// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IExchange} from "./interfaces/IExchange.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {PriceMath} from "./PriceMath.sol";

/// @title PolicyVault
/// @notice An investment wallet that assumes its AI agent can fail or be taken over.
///
/// Three keys with deliberately unequal powers:
///   - owner    (the investor)        sets the policy, approves escalations, deposits and withdraws
///   - guardian (a trusted person)    can only say no: pause, veto, revoke, and halt the
///                                    stop-loss if the price feed breaks. Optional.
///   - agent    (the AI session key)  can only trade allowlisted assets inside the policy
///
/// What the contract enforces regardless of what the agent was told:
///   1. No agent function takes a destination address. The agent can swap between
///      the stable asset and allowlisted assets through one fixed exchange, and
///      nothing else. Funds leave the vault only to the registered withdrawal address.
///   2. Every agent trade is bounded: size per trade and volume per UTC day as
///      shares of the portfolio, exposure per asset and a minimum defensive
///      share after the trade, and execution within a set distance of the
///      oracle price.
///   3. After a daily loss beyond the limit, a stop-loss, or a run of losing
///      trades, the vault is in protect mode: buying is blocked, selling into
///      the stable asset still works.
///   4. Stop-losses do not depend on the agent. Anyone can trigger one once the
///      oracle price is at or below the owner's threshold.
///   5. Risk goes down at once and goes up only after a delay the guardian can
///      veto. That covers the owner as well as the agent: higher limits, new
///      assets, a lower stop price, halting the stop-loss and changing the
///      withdrawal address all wait.
///
/// What it does not do: it cannot limit market losses on assets the policy
/// allows, and it trusts the oracle (see the known-risk list in the docs).
contract PolicyVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum RequestStatus {
        None,
        Pending,
        Approved,
        Rejected
    }

    /// @notice What started a cooldown.
    enum Trigger {
        DailyLoss,
        StopLoss,
        LossStreak
    }

    /// @notice The mandate. Shares are in basis points of the portfolio's value.
    struct Policy {
        uint16 maxTradeBps; // largest single agent trade, as a share of the current value
        uint16 maxDailyVolumeBps; // agent volume per UTC day, buys plus sells, as a share of the day-start value
        uint16 dailyLossBps; // drop from the day-start value that starts protect mode
        uint16 maxSlippageBps; // worst execution against the oracle price a trade may accept
        uint16 minDefensiveBps; // smallest share that must stay in cash and defensive assets after a buy
        uint8 maxLossStreak; // losing sells in a row that start a cooldown; 0 for off
        uint32 cooldown; // seconds without new buying after a loss trigger
    }

    struct AssetRule {
        bool allowed; // the agent may buy it
        bool defensive; // counts toward the minimum defensive share
        uint16 maxExposureBps; // largest share of the portfolio it may be after a buy
        uint256 stopPrice; // oracle price at or below which anyone can sell the holding; 0 for none
    }

    /// @notice One leg of a trade. `amount` is in stable units for a buy and in asset units for a sell.
    struct Order {
        address asset;
        bool isBuy;
        uint256 amount;
    }

    /// @notice A trade above the agent's size limits, waiting for the owner.
    struct Request {
        address asset;
        bool isBuy;
        uint256 amount;
        bytes32 ref;
        uint64 expiry;
        RequestStatus status;
    }

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_ASSETS = 8;
    uint256 public constant MAX_ORDERS = 8;
    uint16 public constant MAX_SLIPPAGE_BPS = 500;
    uint32 public constant MAX_COOLDOWN = 30 days;
    uint64 public constant MAX_AGENT_SESSION = 90 days;
    uint64 public constant REQUEST_TTL = 1 days;
    /// @notice A stop-loss halt lapses on its own, so protection cannot be switched off and forgotten.
    uint64 public constant MAX_HALT = 3 days;

    // Keys in `pendingEta` for changes that wait. An asset rule uses the asset's address as its key.
    bytes32 public constant POLICY_CHANGE = "policy";
    bytes32 public constant HALT_CHANGE = "stop-loss halt";
    bytes32 public constant WITHDRAWAL_CHANGE = "withdrawal address";

    IERC20 public immutable stable;
    IPriceOracle public immutable oracle;
    IExchange public immutable exchange;
    address public immutable owner;
    uint64 public immutable loosenDelay;
    uint64 public immutable maxPriceAge;
    uint256 private immutable _stableUnit;

    address public guardian;
    address public agent;
    uint64 public agentExpiry;
    bool public paused;
    bool public initialized;

    /// @notice Where withdrawals go. Starts as the owner's address.
    address public withdrawalAddress;
    address public pendingWithdrawalAddress;
    uint64 public stopLossHaltedUntil;

    Policy private _policy;
    Policy private _pendingPolicy;
    /// @notice When each waiting change may be applied. Zero means nothing is waiting.
    mapping(bytes32 => uint64) public pendingEta;

    /// @notice The vault's own record of what it holds. Tokens sent to it
    /// directly are not counted, so nobody can shift the risk checks by donating.
    mapping(address => uint256) public holdings;
    mapping(address => uint256) public unitOf;
    /// @notice Stable spent on what is held now, used to tell a losing sell from a winning one.
    mapping(address => uint256) public costBasis;
    mapping(address => AssetRule) private _rules;
    mapping(address => AssetRule) private _pendingRules;
    address[] private _assets;

    uint64 public day;
    uint64 public cooldownUntil;
    uint8 public lossStreak;
    uint256 public dayStartValue;
    uint256 public volumeToday;

    uint256 public requestCount;
    mapping(uint256 => Request) private _requests;

    /// @param usdAmount stable spent on a buy, or received from a sell
    /// @param ref hash of the off-chain record (agent reasoning, risk engine verdict)
    event Trade(
        address indexed asset,
        bool isBuy,
        uint256 usdAmount,
        uint256 assetAmount,
        uint256 price,
        bytes32 ref,
        address indexed by
    );
    event StopLossTriggered(
        address indexed asset, uint256 assetAmount, uint256 usdAmount, uint256 price, address indexed by
    );
    event ProtectModeEntered(Trigger trigger, uint256 drawdownBps, uint64 until);
    event DayStarted(uint64 indexed day, uint256 value);
    event TradeRequested(uint256 indexed requestId, address indexed asset, bool isBuy, uint256 amount, bytes32 ref);
    event RequestApproved(uint256 indexed requestId);
    event RequestRejected(uint256 indexed requestId, address indexed by);
    event Initialized();
    event PolicyProposed(Policy policy, uint64 eta);
    event PolicyChanged(Policy policy);
    event AssetRuleProposed(address indexed asset, AssetRule rule, uint64 eta);
    event AssetRuleChanged(address indexed asset, AssetRule rule);
    event StopLossHaltProposed(uint64 eta);
    event StopLossHalted(address indexed by, uint64 until);
    event StopLossResumed(address indexed by);
    event WithdrawalAddressProposed(address indexed to, uint64 eta);
    event WithdrawalAddressChanged(address indexed to);
    event ChangeCancelled(bytes32 indexed key, address indexed by);
    event AgentSet(address indexed agent, uint64 expiry);
    event AgentRevoked(address indexed by);
    event Paused(address indexed by);
    event Unpaused();
    event GuardianChanged(address indexed from, address indexed to);
    event Deposited(address indexed token, uint256 amount);
    event Withdrawn(address indexed token, uint256 amount);

    error NotOwner();
    error NotGuardian();
    error NotOwnerOrGuardian();
    error NotAgent();
    error AgentKeyExpired();
    error WalletPaused();
    error AlreadyInitialized();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidAgent();
    error InvalidExpiry();
    error InvalidPolicy();
    error GuardianAlreadySet();
    error LengthMismatch();
    error TooManyAssets();
    error TooManyOrders();
    error NotAnAsset(address token);
    error UnknownAsset(address asset);
    error AssetNotAllowed(address asset);
    error StalePrice(address asset, uint256 updatedAt);
    error ExceedsTradeLimit(uint256 usdAmount, uint256 limit);
    error ExceedsDailyVolume(uint256 usdAmount, uint256 remaining);
    error ExceedsExposure(address asset, uint256 exposureBps, uint256 capBps);
    error ExceedsDailyLoss(uint256 drawdownBps, uint256 limitBps);
    error BelowDefensiveFloor(uint256 defensiveBps, uint256 minimumBps);
    error StopLossIsHalted(uint64 until);
    error CooldownActive(uint64 until);
    error BelowStopPrice(address asset, uint256 price, uint256 stopPrice);
    error StopNotReached(address asset, uint256 price, uint256 stopPrice);
    error NothingToSell(address asset);
    error InsufficientBalance(address token, uint256 amount, uint256 available);
    error SlippageTooHigh(uint256 received, uint256 minimum);
    error RequestNotPending(uint256 id);
    error RequestExpired(uint256 id);
    error NoPendingChange();
    error ChangeNotReady(uint64 eta);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOwnerOrGuardian() {
        if (msg.sender != owner && msg.sender != guardian) revert NotOwnerOrGuardian();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        if (block.timestamp >= agentExpiry) revert AgentKeyExpired();
        if (paused) revert WalletPaused();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert WalletPaused();
        _;
    }

    /// @param guardian_ may be zero; the owner can appoint one later
    constructor(
        IERC20 stable_,
        IPriceOracle oracle_,
        IExchange exchange_,
        address owner_,
        address guardian_,
        uint64 loosenDelay_,
        uint64 maxPriceAge_
    ) {
        if (
            address(stable_) == address(0) || address(oracle_) == address(0) || address(exchange_) == address(0)
                || owner_ == address(0)
        ) revert ZeroAddress();
        if (guardian_ == owner_) revert InvalidAgent();
        stable = stable_;
        oracle = oracle_;
        exchange = exchange_;
        owner = owner_;
        withdrawalAddress = owner_;
        guardian = guardian_;
        loosenDelay = loosenDelay_;
        maxPriceAge = maxPriceAge_;
        _stableUnit = 10 ** IERC20Metadata(address(stable_)).decimals();
        day = uint64(block.timestamp / 1 days);
    }

    // ------------------------------------------------------------------
    // Agent: the only functions the AI's key can call
    // ------------------------------------------------------------------

    /// @notice Buy an allowlisted asset with `usdIn` of the stable asset.
    function buy(address asset, uint256 usdIn, bytes32 ref) external onlyAgent nonReentrant returns (uint256 out) {
        return _buy(asset, usdIn, ref, true);
    }

    /// @notice Sell `amount` of an asset into the stable asset. Works in protect mode.
    function sell(address asset, uint256 amount, bytes32 ref) external onlyAgent nonReentrant returns (uint256 out) {
        return _sell(asset, amount, ref, true);
    }

    /// @notice Several trades in one transaction, each checked like a single trade.
    /// If one leg breaks a rule, the whole call reverts.
    function rebalance(Order[] calldata orders, bytes32 ref) external onlyAgent nonReentrant {
        if (orders.length == 0) revert ZeroAmount();
        if (orders.length > MAX_ORDERS) revert TooManyOrders();
        for (uint256 i = 0; i < orders.length; i++) {
            Order calldata o = orders[i];
            if (o.isBuy) _buy(o.asset, o.amount, ref, true);
            else _sell(o.asset, o.amount, ref, true);
        }
    }

    /// @notice Ask the owner to approve a trade that is above the agent's size
    /// limits. Approval lifts the size limits only; every risk rule still applies.
    function requestTrade(address asset, bool isBuy, uint256 amount, bytes32 ref)
        external
        onlyAgent
        returns (uint256 requestId)
    {
        if (amount == 0) revert ZeroAmount();
        if (isBuy) {
            if (!_rules[asset].allowed) revert AssetNotAllowed(asset);
        } else if (unitOf[asset] == 0) {
            revert UnknownAsset(asset);
        }
        requestId = ++requestCount;
        _requests[requestId] =
            Request(asset, isBuy, amount, ref, uint64(block.timestamp) + REQUEST_TTL, RequestStatus.Pending);
        emit TradeRequested(requestId, asset, isBuy, amount, ref);
    }

    // ------------------------------------------------------------------
    // Anyone: protection that does not depend on the agent
    // ------------------------------------------------------------------

    /// @notice Sell the whole holding of `asset` into the stable asset once the
    /// oracle price is at or below the owner's stop price. Anyone can call it.
    /// The proceeds stay in the vault and the caller gets nothing.
    /// Pausing the agent does not stop it. Only a halt does, and a halt is
    /// instant for the guardian alone.
    function triggerStopLoss(address asset) external nonReentrant returns (uint256 usdOut) {
        if (block.timestamp < stopLossHaltedUntil) revert StopLossIsHalted(stopLossHaltedUntil);
        uint256 amount = holdings[asset];
        if (amount == 0) revert NothingToSell(asset);
        uint256 price = _price(asset, true);
        uint256 stopPrice = _rules[asset].stopPrice;
        if (price > stopPrice) revert StopNotReached(asset, price, stopPrice);

        (usdOut,) = _swapSell(asset, amount, price);
        emit StopLossTriggered(asset, amount, usdOut, price, msg.sender);
        _startCooldown(Trigger.StopLoss, 0);
    }

    /// @notice Take the day-start snapshot if a new UTC day has begun, and start
    /// protect mode if the daily loss limit has been reached. Anyone can call it.
    function poke() external nonReentrant {
        _latch(_rollDay());
    }

    // ------------------------------------------------------------------
    // Owner: policy, approvals, deposits and withdrawals
    // ------------------------------------------------------------------

    /// @notice Set the first policy. Works once. Every later change that
    /// loosens anything goes through the waiting period.
    function initialize(Policy calldata p, address[] calldata assets, AssetRule[] calldata rules) external onlyOwner {
        if (initialized) revert AlreadyInitialized();
        if (assets.length != rules.length) revert LengthMismatch();
        _validate(p);
        initialized = true;
        _policy = p;
        emit PolicyChanged(p);
        for (uint256 i = 0; i < assets.length; i++) {
            _setRule(assets[i], rules[i]);
        }
        emit Initialized();
    }

    /// @notice Change the mandate. If nothing gets looser, it applies now.
    /// Otherwise the whole change waits for loosenDelay and the guardian can veto it.
    function proposePolicy(Policy calldata p) external onlyOwner {
        _validate(p);
        Policy memory cur = _policy;
        // a streak limit of zero means off, which is the loosest setting
        bool streakOk = p.maxLossStreak == cur.maxLossStreak
            || (p.maxLossStreak != 0 && (cur.maxLossStreak == 0 || p.maxLossStreak < cur.maxLossStreak));
        bool tighter = streakOk && p.maxTradeBps <= cur.maxTradeBps && p.maxDailyVolumeBps <= cur.maxDailyVolumeBps
            && p.dailyLossBps <= cur.dailyLossBps && p.maxSlippageBps <= cur.maxSlippageBps
            && p.minDefensiveBps >= cur.minDefensiveBps && p.cooldown >= cur.cooldown;
        if (tighter) {
            delete pendingEta[POLICY_CHANGE];
            _policy = p;
            emit PolicyChanged(p);
        } else {
            _pendingPolicy = p;
            emit PolicyProposed(p, _queue(POLICY_CHANGE));
        }
    }

    function applyPolicy() external onlyOwner {
        _take(POLICY_CHANGE);
        _policy = _pendingPolicy;
        emit PolicyChanged(_policy);
    }

    /// @notice Change the rule for one asset. Stricter means: not allowed, not
    /// counted as defensive, a lower exposure cap, or a higher stop price.
    /// Anything else waits.
    function proposeAssetRule(address asset, AssetRule calldata rule) external onlyOwner {
        _validateRule(asset, rule);
        AssetRule memory cur = _rules[asset];
        bool tighter = (!rule.allowed || cur.allowed) && (!rule.defensive || cur.defensive)
            && rule.maxExposureBps <= cur.maxExposureBps && rule.stopPrice >= cur.stopPrice;
        bytes32 key = ruleKey(asset);
        if (tighter) {
            delete pendingEta[key];
            _setRule(asset, rule);
        } else {
            _pendingRules[asset] = rule;
            emit AssetRuleProposed(asset, rule, _queue(key));
        }
    }

    function applyAssetRule(address asset) external onlyOwner {
        _take(ruleKey(asset));
        _setRule(asset, _pendingRules[asset]);
    }

    /// @notice Ask to move the withdrawal address. It always waits, so someone
    /// who talks the owner into "updating" it, or steals the owner key, cannot
    /// redirect funds before the guardian has had time to veto.
    function proposeWithdrawalAddress(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (to == agent || to == address(this)) revert InvalidAgent();
        pendingWithdrawalAddress = to;
        emit WithdrawalAddressProposed(to, _queue(WITHDRAWAL_CHANGE));
    }

    function applyWithdrawalAddress() external onlyOwner {
        _take(WITHDRAWAL_CHANGE);
        withdrawalAddress = pendingWithdrawalAddress;
        emit WithdrawalAddressChanged(withdrawalAddress);
    }

    function applyStopLossHalt() external onlyOwner {
        _take(HALT_CHANGE);
        _haltStopLoss();
    }

    /// @notice Approve a trade the agent could not make alone. It skips the
    /// agent's size limits and nothing else.
    function approveRequest(uint256 requestId) external onlyOwner whenNotPaused nonReentrant {
        Request storage r = _requests[requestId];
        if (r.status != RequestStatus.Pending) revert RequestNotPending(requestId);
        if (block.timestamp > r.expiry) revert RequestExpired(requestId);
        r.status = RequestStatus.Approved;
        emit RequestApproved(requestId);
        if (r.isBuy) _buy(r.asset, r.amount, r.ref, false);
        else _sell(r.asset, r.amount, r.ref, false);
    }

    /// @notice Give the agent a session key. Its powers stay bounded by the policy.
    function setAgent(address newAgent, uint64 expiry) external onlyOwner {
        if (newAgent == address(0) || newAgent == owner || newAgent == guardian) revert InvalidAgent();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_AGENT_SESSION) revert InvalidExpiry();
        agent = newAgent;
        agentExpiry = expiry;
        emit AgentSet(newAgent, expiry);
    }

    /// @notice Appoint a guardian if there is none. Once set, only the guardian can pass the role on.
    function setGuardian(address newGuardian) external onlyOwner {
        if (guardian != address(0)) revert GuardianAlreadySet();
        if (newGuardian == address(0)) revert ZeroAddress();
        if (newGuardian == owner || newGuardian == agent) revert InvalidAgent();
        guardian = newGuardian;
        emit GuardianChanged(address(0), newGuardian);
    }

    /// @notice Put the stable asset or a listed asset into the vault.
    function deposit(address token, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (token != address(stable) && unitOf[token] == 0) revert UnknownAsset(token);
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - before;
        holdings[token] += received;
        // a deposit is not a gain, so the day-start value moves with it
        uint256 value = _valueOf(token, received);
        dayStartValue += value;
        if (token != address(stable)) costBasis[token] += value;
        emit Deposited(token, received);
    }

    /// @notice Take funds out, at any time and without a wait. They can only go
    /// to the registered withdrawal address. The mandate governs the agent; it
    /// never holds the owner's money back.
    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = holdings[token];
        if (amount > available) revert InsufficientBalance(token, amount, available);
        // a withdrawal is not a loss, so the day-start value moves with it
        uint256 value = _valueOf(token, amount);
        dayStartValue = dayStartValue > value ? dayStartValue - value : 0;
        costBasis[token] -= costBasis[token] * amount / available;
        holdings[token] = available - amount;
        IERC20(token).safeTransfer(withdrawalAddress, amount);
        emit Withdrawn(token, amount);
    }

    /// @notice Send tokens that arrived outside `deposit` to the withdrawal address.
    function sweep(address token) external onlyOwner nonReentrant {
        uint256 extra = IERC20(token).balanceOf(address(this)) - holdings[token];
        if (extra == 0) revert ZeroAmount();
        IERC20(token).safeTransfer(withdrawalAddress, extra);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused();
    }

    // ------------------------------------------------------------------
    // Owner or guardian: everything that makes the vault stricter
    // ------------------------------------------------------------------

    /// @notice Stop the agent. The stop-loss keeps working.
    function pause() external onlyOwnerOrGuardian {
        paused = true;
        emit Paused(msg.sender);
    }

    function revokeAgent() external onlyOwnerOrGuardian {
        agent = address(0);
        agentExpiry = 0;
        emit AgentRevoked(msg.sender);
    }

    function rejectRequest(uint256 requestId) external onlyOwnerOrGuardian {
        if (_requests[requestId].status != RequestStatus.Pending) revert RequestNotPending(requestId);
        _requests[requestId].status = RequestStatus.Rejected;
        emit RequestRejected(requestId, msg.sender);
    }

    /// @notice Drop a change that is waiting. This is the guardian's veto.
    /// @param key POLICY_CHANGE, HALT_CHANGE, WITHDRAWAL_CHANGE, or `ruleKey(asset)`
    function cancelChange(bytes32 key) external onlyOwnerOrGuardian {
        if (pendingEta[key] == 0) revert NoPendingChange();
        delete pendingEta[key];
        emit ChangeCancelled(key, msg.sender);
    }

    /// @notice Stop the public stop-loss, for example when the price feed is
    /// wrong. From the guardian it applies now. From the owner it is a
    /// loosening like any other and waits, so an owner who wants to "hold on,
    /// it will come back" in a crash cannot switch their own protection off.
    function haltStopLoss() external onlyOwnerOrGuardian {
        if (msg.sender == guardian) _haltStopLoss();
        else emit StopLossHaltProposed(_queue(HALT_CHANGE));
    }

    function resumeStopLoss() external onlyOwnerOrGuardian {
        stopLossHaltedUntil = 0;
        delete pendingEta[HALT_CHANGE];
        emit StopLossResumed(msg.sender);
    }

    /// @notice Only the guardian can hand the guardian role to someone else,
    /// so the owner cannot remove the veto.
    function transferGuardian(address newGuardian) external {
        if (msg.sender != guardian) revert NotGuardian();
        if (newGuardian == address(0)) revert ZeroAddress();
        if (newGuardian == owner || newGuardian == agent) revert InvalidAgent();
        emit GuardianChanged(guardian, newGuardian);
        guardian = newGuardian;
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice What a fully compromised agent key could still do today.
    /// @return tradable the volume it could still trade between allowlisted assets
    /// @return maxCost the most those trades could cost against the oracle price
    /// What it could send out of the vault is not returned because it is always zero.
    function agentExposure() external view returns (uint256 tradable, uint256 maxCost) {
        if (paused || agent == address(0) || block.timestamp >= agentExpiry) return (0, 0);
        tradable = dailyVolumeRemaining();
        maxCost = tradable * _policy.maxSlippageBps / BPS;
    }

    /// @notice Agent volume still available today, in stable units.
    function dailyVolumeRemaining() public view returns (uint256) {
        bool sameDay = block.timestamp / 1 days == day;
        uint256 cap = (sameDay ? dayStartValue : portfolioValue()) * _policy.maxDailyVolumeBps / BPS;
        uint256 used = sameDay ? volumeToday : 0;
        return cap > used ? cap - used : 0;
    }

    /// @notice Value of everything the vault holds, in stable units, at the last oracle prices.
    function portfolioValue() public view returns (uint256 total) {
        (total,) = _values(false);
    }

    /// @notice Loss since the day-start snapshot, in basis points. Zero on a new day until the first snapshot.
    function drawdownBps() public view returns (uint256) {
        if (block.timestamp / 1 days != day) return 0;
        return _drawdownBps(portfolioValue());
    }

    function inProtectMode() external view returns (bool) {
        return block.timestamp < cooldownUntil || drawdownBps() >= _policy.dailyLossBps;
    }

    /// @notice Share of the portfolio in cash and defensive assets, in basis points.
    function defensiveBps() external view returns (uint256) {
        (uint256 total, uint256 defensive) = _values(false);
        return total == 0 ? BPS : defensive * BPS / total;
    }

    function ruleKey(address asset) public pure returns (bytes32) {
        return bytes32(uint256(uint160(asset)));
    }

    function exposureBps(address asset) external view returns (uint256) {
        uint256 total = portfolioValue();
        if (total == 0 || holdings[asset] == 0 || unitOf[asset] == 0) return 0;
        return _valueOf(asset, holdings[asset]) * BPS / total;
    }

    function getAssets() external view returns (address[] memory) {
        return _assets;
    }

    function getRule(address asset) external view returns (AssetRule memory) {
        return _rules[asset];
    }

    function getPolicy() external view returns (Policy memory) {
        return _policy;
    }

    /// @notice The mandate that is waiting, if `pendingEta(POLICY_CHANGE)` is not zero.
    function getPendingPolicy() external view returns (Policy memory) {
        return _pendingPolicy;
    }

    /// @notice The rule that is waiting, if `pendingEta(ruleKey(asset))` is not zero.
    function getPendingRule(address asset) external view returns (AssetRule memory) {
        return _pendingRules[asset];
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// @param limited true for the agent, false for a trade the owner approved
    function _buy(address asset, uint256 usdIn, bytes32 ref, bool limited) internal returns (uint256 out) {
        if (usdIn == 0) revert ZeroAmount();
        AssetRule memory rule = _rules[asset];
        if (!rule.allowed) revert AssetNotAllowed(asset);
        uint256 value = _rollDay();
        if (limited) _useAgentLimits(usdIn, value);
        _requireNotProtected(value);
        uint256 price = _price(asset, true);
        if (price <= rule.stopPrice) revert BelowStopPrice(asset, price, rule.stopPrice);
        uint256 available = holdings[address(stable)];
        if (usdIn > available) revert InsufficientBalance(address(stable), usdIn, available);

        out = _swapBuy(asset, usdIn, price);

        value = _requireWithinMandate(asset, price, rule);
        emit Trade(asset, true, usdIn, out, price, ref, msg.sender);
        _latch(value);
    }

    function _requireNotProtected(uint256 value) internal view {
        if (block.timestamp < cooldownUntil) revert CooldownActive(cooldownUntil);
        uint256 drawdown = _drawdownBps(value);
        if (drawdown >= _policy.dailyLossBps) revert ExceedsDailyLoss(drawdown, _policy.dailyLossBps);
    }

    /// @dev The portfolio-level rules, checked on the state after a buy.
    function _requireWithinMandate(address asset, uint256 price, AssetRule memory rule)
        internal
        view
        returns (uint256 total)
    {
        uint256 defensive;
        (total, defensive) = _values(true);
        uint256 exposure = PriceMath.toStable(holdings[asset], price, unitOf[asset], _stableUnit) * BPS / total;
        if (exposure > rule.maxExposureBps) revert ExceedsExposure(asset, exposure, rule.maxExposureBps);
        // buying a defensive asset with cash moves the defensive share only by the fee
        if (!rule.defensive) {
            uint256 share = defensive * BPS / total;
            if (share < _policy.minDefensiveBps) revert BelowDefensiveFloor(share, _policy.minDefensiveBps);
        }
    }

    function _sell(address asset, uint256 amount, bytes32 ref, bool limited) internal returns (uint256 out) {
        if (amount == 0) revert ZeroAmount();
        if (unitOf[asset] == 0) revert UnknownAsset(asset);
        uint256 available = holdings[asset];
        if (amount > available) revert InsufficientBalance(asset, amount, available);
        uint256 value = _rollDay();
        uint256 price = _price(asset, true);
        // dust worth less than one stable unit would otherwise slip past the volume count
        uint256 usdValue = PriceMath.toStable(amount, price, unitOf[asset], _stableUnit);
        if (usdValue == 0) revert ZeroAmount();
        if (limited) _useAgentLimits(usdValue, value);

        bool lost;
        (out, lost) = _swapSell(asset, amount, price);
        emit Trade(asset, false, out, amount, price, ref, msg.sender);

        // a run of losing sells starts a cooldown, so losses cannot be chased with new buying
        uint8 maxStreak = _policy.maxLossStreak;
        if (!lost || maxStreak == 0) {
            lossStreak = 0;
        } else if (++lossStreak >= maxStreak) {
            lossStreak = 0;
            _startCooldown(Trigger.LossStreak, 0);
        }
        _latch(_strictValue());
    }

    function _strictValue() internal view returns (uint256 total) {
        (total,) = _values(true);
    }

    /// @param value the portfolio's value before the trade
    function _useAgentLimits(uint256 usdAmount, uint256 value) internal {
        uint256 limit = value * _policy.maxTradeBps / BPS;
        if (usdAmount > limit) revert ExceedsTradeLimit(usdAmount, limit);
        uint256 remaining = dailyVolumeRemaining();
        if (usdAmount > remaining) revert ExceedsDailyVolume(usdAmount, remaining);
        volumeToday += usdAmount;
    }

    /// @dev Balances are measured before and after, so the vault's books never
    /// depend on what the exchange reports.
    function _swapBuy(address asset, uint256 usdIn, uint256 price) internal returns (uint256 received) {
        uint256 minOut =
            PriceMath.toAsset(usdIn, price, unitOf[asset], _stableUnit) * (BPS - _policy.maxSlippageBps) / BPS;
        uint256 stableBefore = stable.balanceOf(address(this));
        uint256 assetBefore = IERC20(asset).balanceOf(address(this));

        stable.forceApprove(address(exchange), usdIn);
        exchange.buy(asset, usdIn, minOut);
        stable.forceApprove(address(exchange), 0);

        received = IERC20(asset).balanceOf(address(this)) - assetBefore;
        if (received < minOut) revert SlippageTooHigh(received, minOut);
        uint256 spent = stableBefore - stable.balanceOf(address(this));
        holdings[address(stable)] -= spent;
        holdings[asset] += received;
        costBasis[asset] += spent;
    }

    /// @return received stable that came back
    /// @return lost true when that is less than what the sold part of the holding cost
    function _swapSell(address asset, uint256 amount, uint256 price) internal returns (uint256 received, bool lost) {
        uint256 minOut =
            PriceMath.toStable(amount, price, unitOf[asset], _stableUnit) * (BPS - _policy.maxSlippageBps) / BPS;
        uint256 stableBefore = stable.balanceOf(address(this));
        uint256 assetBefore = IERC20(asset).balanceOf(address(this));

        IERC20(asset).forceApprove(address(exchange), amount);
        exchange.sell(asset, amount, minOut);
        IERC20(asset).forceApprove(address(exchange), 0);

        received = stable.balanceOf(address(this)) - stableBefore;
        if (received < minOut) revert SlippageTooHigh(received, minOut);
        uint256 sold = assetBefore - IERC20(asset).balanceOf(address(this));
        uint256 held = holdings[asset];
        uint256 cost = costBasis[asset] * sold / held;
        lost = received < cost;
        costBasis[asset] -= cost;
        holdings[asset] = held - sold;
        holdings[address(stable)] += received;
    }

    /// @dev Starts a new UTC day on the first touch after midnight. Needs fresh prices.
    function _rollDay() internal returns (uint256 value) {
        value = _strictValue();
        uint64 today = uint64(block.timestamp / 1 days);
        if (today != day) {
            day = today;
            dayStartValue = value;
            volumeToday = 0;
            emit DayStarted(today, value);
        }
    }

    /// @dev Starts the cooldown when the daily loss limit is reached and no cooldown is running.
    function _latch(uint256 value) internal {
        if (block.timestamp < cooldownUntil) return;
        uint256 drawdown = _drawdownBps(value);
        if (drawdown < _policy.dailyLossBps || drawdown == 0) return;
        _startCooldown(Trigger.DailyLoss, drawdown);
    }

    function _startCooldown(Trigger trigger, uint256 drawdown) internal {
        uint64 until = uint64(block.timestamp) + _policy.cooldown;
        if (until > cooldownUntil) cooldownUntil = until;
        emit ProtectModeEntered(trigger, drawdown, cooldownUntil);
    }

    function _haltStopLoss() internal {
        stopLossHaltedUntil = uint64(block.timestamp) + MAX_HALT;
        emit StopLossHalted(msg.sender, stopLossHaltedUntil);
    }

    function _queue(bytes32 key) internal returns (uint64 eta) {
        eta = uint64(block.timestamp) + loosenDelay;
        pendingEta[key] = eta;
    }

    /// @dev Reverts unless the change under `key` has waited out its delay, then clears it.
    function _take(bytes32 key) internal {
        uint64 eta = pendingEta[key];
        if (eta == 0) revert NoPendingChange();
        if (block.timestamp < eta) revert ChangeNotReady(eta);
        delete pendingEta[key];
    }

    function _drawdownBps(uint256 value) internal view returns (uint256) {
        uint256 start = dayStartValue;
        if (start == 0 || value >= start) return 0;
        return (start - value) * BPS / start;
    }

    /// @return total value of everything held, in stable units
    /// @return defensive the part of it in cash and defensive assets
    function _values(bool strict) internal view returns (uint256 total, uint256 defensive) {
        total = holdings[address(stable)];
        defensive = total;
        uint256 n = _assets.length;
        for (uint256 i = 0; i < n; i++) {
            address a = _assets[i];
            uint256 held = holdings[a];
            if (held == 0) continue;
            uint256 v = PriceMath.toStable(held, _price(a, strict), unitOf[a], _stableUnit);
            total += v;
            if (_rules[a].defensive) defensive += v;
        }
    }

    function _valueOf(address token, uint256 amount) internal view returns (uint256) {
        if (token == address(stable)) return amount;
        return PriceMath.toStable(amount, _price(token, false), unitOf[token], _stableUnit);
    }

    /// @param strict revert if the price is older than maxPriceAge
    function _price(address asset, bool strict) internal view returns (uint256 price) {
        uint256 updatedAt;
        (price, updatedAt) = oracle.getPrice(asset);
        if (strict && block.timestamp > updatedAt + maxPriceAge) revert StalePrice(asset, updatedAt);
    }

    function _validate(Policy calldata p) internal pure {
        if (
            p.maxTradeBps > BPS || p.dailyLossBps > BPS || p.minDefensiveBps > BPS
                || p.maxSlippageBps > MAX_SLIPPAGE_BPS || p.cooldown > MAX_COOLDOWN
        ) revert InvalidPolicy();
    }

    function _validateRule(address asset, AssetRule calldata rule) internal view {
        if (asset == address(0)) revert ZeroAddress();
        if (asset == address(stable)) revert NotAnAsset(asset);
        if (rule.maxExposureBps > BPS) revert InvalidPolicy();
        // reverts if the oracle has no feed for it
        oracle.getPrice(asset);
    }

    function _setRule(address asset, AssetRule memory rule) internal {
        if (unitOf[asset] == 0) {
            if (asset == address(0)) revert ZeroAddress();
            if (asset == address(stable)) revert NotAnAsset(asset);
            if (rule.maxExposureBps > BPS) revert InvalidPolicy();
            if (_assets.length == MAX_ASSETS) revert TooManyAssets();
            oracle.getPrice(asset);
            unitOf[asset] = 10 ** IERC20Metadata(asset).decimals();
            _assets.push(asset);
        }
        _rules[asset] = rule;
        emit AssetRuleChanged(asset, rule);
    }
}
