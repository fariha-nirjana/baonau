// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IExchange} from "./interfaces/IExchange.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {Mandate} from "./Mandate.sol";
import {PriceMath} from "./PriceMath.sol";
import {AssetRule, Commitment, Policy} from "./Types.sol";

/// @title PolicyVault
/// @notice Holds one investor's assets and lets an AI agent trade them, but
/// only as far as the investor's mandate allows. The mandate is a separate
/// contract this vault is bound to for good. The vault reads every limit from
/// it and enforces them here, whatever the agent was told.
///
///   1. No agent function takes a destination address. The agent can swap
///      between the stable asset and allowlisted assets through one fixed
///      exchange, and nothing else. Funds leave only through `withdraw`, to
///      the address registered in the mandate.
///   2. Every agent trade is bounded: size per trade and volume per UTC day as
///      shares of the portfolio, exposure per asset and a minimum defensive
///      share after the trade, and execution within a set distance of the
///      oracle price.
///   3. After a daily loss beyond the limit, a stop-loss, or a run of losing
///      sells, buying is blocked for a while. Selling into the stable asset
///      still works.
///   4. Stop-losses do not depend on the agent. Anyone can trigger one once
///      the oracle price is at or below the owner's threshold.
///   5. The owner can sign an approval for one exact trade above the agent's
///      size limits. It lifts those two limits for that trade, once, and
///      nothing else.
///   6. Money the owner sets aside for a commitment is not part of the portfolio:
///      the agent cannot trade it and the limits are measured without it. It
///      leaves only as a payment to that commitment's payee, within the commitment's terms,
///      or to the owner's withdrawal address. Moving it back into investing waits.
///
/// What it does not do: it cannot limit market losses on assets the mandate
/// allows, and it trusts the oracle (see the known-risk list in the docs).
contract PolicyVault is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice What started a cooldown.
    enum Trigger {
        DailyLoss,
        StopLoss,
        LossStreak
    }

    /// @notice One leg of a trade. `amount` is in stable units for a buy and in asset units for a sell.
    struct Order {
        address asset;
        bool isBuy;
        uint256 amount;
    }

    /// @notice What the owner signs to approve one trade above the agent's size limits.
    /// A buy spends `amount` of the stable asset on `assetOut`. A sell sells `amount` of `assetIn`.
    struct TradeApproval {
        uint8 action; // 0 buy, 1 sell
        address assetIn;
        address assetOut;
        uint256 amount;
        uint256 nonce;
        uint64 validFrom;
        uint64 expiry;
    }

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_ORDERS = 8;
    /// @notice An approval is good for an hour at most, so a signature cannot sit around for days.
    uint64 public constant MAX_APPROVAL_LIFETIME = 1 hours;

    bytes32 public constant APPROVAL_TYPEHASH = keccak256(
        "TradeApproval(uint8 action,address assetIn,address assetOut,uint256 amount,uint256 nonce,uint64 validFrom,uint64 expiry)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @notice The mandate that governs this vault. Set when both are created and never changed.
    Mandate public mandate;
    IERC20 public stable;
    IPriceOracle public oracle;
    IExchange public exchange;
    uint64 public maxPriceAge;
    uint256 private _stableUnit;

    /// @notice The vault's own record of what it holds. Tokens sent to it
    /// directly are not counted, so nobody can shift the risk checks by donating.
    mapping(address => uint256) public holdings;
    /// @notice Stable spent on what is held now, used to tell a losing sell from a winning one.
    mapping(address => uint256) public costBasis;
    mapping(uint256 => bool) public usedNonce;

    /// @notice Stable set aside for each commitment. It is part of `holdings[stable]` but never traded.
    mapping(uint256 => uint256) public reserved;
    uint256 public reservedTotal;
    /// @notice The amount waiting to go back into investing, while `mandate.pendingEta(releaseKey(id))` is set.
    mapping(uint256 => uint256) public pendingRelease;

    uint64 public day;
    uint64 public cooldownUntil;
    uint8 public lossStreak;
    uint256 public dayStartValue;
    uint256 public volumeToday;

    /// @param usdAmount stable spent on a buy, or received from a sell
    /// @param ref hash of the off-chain record (agent reasoning, gate trace)
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
    event ApprovalUsed(uint256 indexed nonce, uint8 action, address assetIn, address assetOut, uint256 amount);
    event ApprovalCancelled(uint256 indexed nonce);
    event Deposited(address indexed token, uint256 amount);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    event Reserved(uint256 indexed id, uint256 amount);
    event ReleaseProposed(uint256 indexed id, uint256 amount, uint64 eta);
    event Released(uint256 indexed id, uint256 amount);
    event CommitmentPaid(uint256 indexed id, address indexed payee, uint256 amount, uint64 due, bytes32 ref, address indexed by);

    error NotOwner();
    error ZeroAddress();
    error ZeroAmount();
    error TooManyOrders();
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
    error BadApproval();
    error ApprovalAlreadyUsed(uint256 nonce);
    error ApprovalNotValidNow(uint64 validFrom, uint64 expiry);
    error ApprovalTooLong();
    error CommitmentNotPayable(uint256 id);
    error CommitmentNotDue(uint256 id, uint64 due);
    error ExceedsCommitmentAmount(uint256 amount, uint256 maxAmount);
    error ExceedsReserve(uint256 amount, uint256 reserve);

    modifier onlyOwner() {
        if (msg.sender != mandate.owner()) revert NotOwner();
        _;
    }

    /// @dev Reverts in the mandate unless the caller is the agent with a live key and is not paused.
    modifier onlyAgent() {
        mandate.requireAgent(msg.sender);
        _;
    }

    /// @dev The template that vaults are copied from can never be set up itself.
    constructor() {
        _disableInitializers();
    }

    /// @notice Called once by the factory, in the transaction that creates the copy.
    function init(Mandate mandate_, IERC20 stable_, IPriceOracle oracle_, IExchange exchange_, uint64 maxPriceAge_)
        external
        initializer
    {
        if (
            address(mandate_) == address(0) || address(stable_) == address(0) || address(oracle_) == address(0)
                || address(exchange_) == address(0)
        ) revert ZeroAddress();
        mandate = mandate_;
        stable = stable_;
        oracle = oracle_;
        exchange = exchange_;
        maxPriceAge = maxPriceAge_;
        _stableUnit = PriceMath.unitOf(address(stable_));
        day = uint64(block.timestamp / 1 days);
    }

    // ------------------------------------------------------------------
    // Agent: the only functions the AI's key can call
    // ------------------------------------------------------------------

    /// @notice Buy an allowlisted asset with `usdIn` of the stable asset.
    function buy(address asset, uint256 usdIn, bytes32 ref) external onlyAgent nonReentrant returns (uint256 out) {
        return _buy(asset, usdIn, ref, true);
    }

    /// @notice Sell `amount` of an asset into the stable asset. Works while buying is blocked.
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

    /// @notice Make one trade the owner has signed for. The signature lifts the
    /// per-trade and daily-volume limits for exactly this trade, once. The
    /// allowlist, the exposure cap, the defensive floor, protect mode, the
    /// cooldown, the stop price and the slippage limit all still apply.
    function tradeWithApproval(TradeApproval calldata a, bytes calldata signature, bytes32 ref)
        external
        onlyAgent
        nonReentrant
        returns (uint256 out)
    {
        if (usedNonce[a.nonce]) revert ApprovalAlreadyUsed(a.nonce);
        if (block.timestamp < a.validFrom || block.timestamp > a.expiry) revert ApprovalNotValidNow(a.validFrom, a.expiry);
        if (a.expiry - a.validFrom > MAX_APPROVAL_LIFETIME) revert ApprovalTooLong();
        (address signer, ECDSA.RecoverError err) = ECDSA.tryRecover(approvalDigest(a), signature);
        if (err != ECDSA.RecoverError.NoError || signer != mandate.owner()) revert BadApproval();

        usedNonce[a.nonce] = true;
        emit ApprovalUsed(a.nonce, a.action, a.assetIn, a.assetOut, a.amount);
        if (a.action == 0 && a.assetIn == address(stable)) return _buy(a.assetOut, a.amount, ref, false);
        if (a.action == 1 && a.assetOut == address(stable)) return _sell(a.assetIn, a.amount, ref, false);
        revert BadApproval();
    }

    // ------------------------------------------------------------------
    // Anyone: protection that does not depend on the agent
    // ------------------------------------------------------------------

    /// @notice Sell the whole holding of `asset` into the stable asset once the
    /// oracle price is at or below the owner's stop price. Anyone can call it.
    /// The proceeds stay in the vault and the caller gets nothing.
    /// Pausing the agent does not stop it. Only a halt in the mandate does.
    function triggerStopLoss(address asset) external nonReentrant returns (uint256 usdOut) {
        uint64 haltedUntil = mandate.stopLossHaltedUntil();
        if (block.timestamp < haltedUntil) revert StopLossIsHalted(haltedUntil);
        uint256 amount = holdings[asset];
        if (amount == 0) revert NothingToSell(asset);
        uint256 price = _price(asset, true);
        uint256 stopPrice = mandate.getRule(asset).stopPrice;
        if (price > stopPrice) revert StopNotReached(asset, price, stopPrice);

        Policy memory p = mandate.getPolicy();
        (usdOut,) = _swapSell(asset, amount, price, p.maxSlippageBps);
        emit StopLossTriggered(asset, amount, usdOut, price, msg.sender);
        _startCooldown(Trigger.StopLoss, 0, p.cooldown);
    }

    /// @notice Take the day-start snapshot if a new UTC day has begun, and start
    /// protect mode if the daily loss limit has been reached. Anyone can call it.
    function poke() external nonReentrant {
        _latch(_rollDay(), mandate.getPolicy());
    }

    // ------------------------------------------------------------------
    // Owner: deposits, withdrawals, approvals
    // ------------------------------------------------------------------

    /// @notice Put the stable asset or a listed asset into the vault.
    function deposit(address token, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (token != address(stable) && mandate.unitOf(token) == 0) revert UnknownAsset(token);
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
    /// to the withdrawal address registered in the mandate. Taking out
    /// everything ends the mandate: the agent's key is revoked.
    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = holdings[token];
        if (amount > available) revert InsufficientBalance(token, amount, available);
        uint256 fromReserves;
        if (token == address(stable) && amount > available - reservedTotal) {
            // money set aside for commitments is the owner's too, so it comes out without a wait
            fromReserves = amount - (available - reservedTotal);
            _drainReserves(fromReserves);
        }
        // a withdrawal is not a loss, so the day-start value moves with it; reserves were never counted
        uint256 value = _valueOf(token, amount - fromReserves);
        dayStartValue = dayStartValue > value ? dayStartValue - value : 0;
        costBasis[token] -= costBasis[token] * amount / available;
        holdings[token] = available - amount;
        address to = mandate.withdrawalAddress();
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, amount, to);
        if (_isEmpty()) mandate.terminate();
    }

    // ------------------------------------------------------------------
    // Commitments: money with a job already
    // ------------------------------------------------------------------

    /// @notice Set cash aside for a commitment, at once. It leaves the portfolio: the
    /// agent cannot trade it and the limits are measured without it.
    function reserve(uint256 id, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        // any commitment that exists, even one still waiting to apply: setting money aside only lowers risk
        if (id == 0 || id > mandate.commitmentCount()) revert CommitmentNotPayable(id);
        uint256 free = holdings[address(stable)] - reservedTotal;
        if (amount > free) revert InsufficientBalance(address(stable), amount, free);
        reserved[id] += amount;
        reservedTotal += amount;
        // setting money aside is not a loss; a new day's snapshot will not count it anyway
        if (_sameDay()) dayStartValue = dayStartValue > amount ? dayStartValue - amount : 0;
        emit Reserved(id, amount);
    }

    /// @notice Ask to move money set aside for a commitment back into investing. It
    /// waits, and the guardian can cancel it with `mandate.cancelChange(releaseKey(id))`.
    function proposeRelease(uint256 id, uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        if (amount > reserved[id]) revert ExceedsReserve(amount, reserved[id]);
        pendingRelease[id] = amount;
        emit ReleaseProposed(id, amount, mandate.queueRelease(id));
    }

    function applyRelease(uint256 id) external onlyOwner nonReentrant {
        mandate.takeRelease(id);
        uint256 amount = pendingRelease[id];
        // a payment made during the wait may have used part of it
        if (amount > reserved[id]) amount = reserved[id];
        delete pendingRelease[id];
        _unreserve(id, amount);
        // back in the portfolio, and not a gain
        if (_sameDay()) dayStartValue += amount;
        emit Released(id, amount);
    }

    /// @notice Pay a commitment from what is set aside for it. The agent may pay only
    /// once the due window has opened; the owner may pay early. Either way the
    /// payment counts for the current due date, which then moves on, so no date
    /// is paid twice.
    function payCommitment(uint256 id, uint256 amount, bytes32 ref) external nonReentrant {
        Commitment memory b = mandate.getCommitment(id);
        if (msg.sender != mandate.owner()) {
            mandate.requireAgent(msg.sender);
            if (block.timestamp + b.window < b.nextDue) revert CommitmentNotDue(id, b.nextDue);
        }
        if (!b.active || b.payee == address(0)) revert CommitmentNotPayable(id);
        if (amount == 0) revert ZeroAmount();
        if (amount > b.maxAmount) revert ExceedsCommitmentAmount(amount, b.maxAmount);
        if (amount > reserved[id]) revert ExceedsReserve(amount, reserved[id]);

        mandate.markPaid(id);
        _unreserve(id, amount);
        holdings[address(stable)] -= amount;
        stable.safeTransfer(b.payee, amount);
        emit CommitmentPaid(id, b.payee, amount, b.nextDue, ref, msg.sender);
    }

    /// @notice Send tokens that arrived outside `deposit` to the withdrawal address.
    function sweep(address token) external onlyOwner nonReentrant {
        uint256 extra = IERC20(token).balanceOf(address(this)) - holdings[token];
        if (extra == 0) revert ZeroAmount();
        IERC20(token).safeTransfer(mandate.withdrawalAddress(), extra);
    }

    /// @notice Make a signed approval unusable before it is used.
    function cancelApproval(uint256 nonce) external onlyOwner {
        usedNonce[nonce] = true;
        emit ApprovalCancelled(nonce);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice What a fully compromised agent key could still do today.
    /// @return tradable the volume it could still trade between allowlisted assets
    /// @return maxCost the most those trades could cost against the oracle price
    /// What it could send out of the vault is not returned because it is always zero.
    function agentExposure() external view returns (uint256 tradable, uint256 maxCost) {
        if (!mandate.agentActive()) return (0, 0);
        Policy memory p = mandate.getPolicy();
        tradable = _volumeRemaining(p.maxDailyVolumeBps);
        maxCost = tradable * p.maxSlippageBps / BPS;
    }

    /// @notice Agent volume still available today, in stable units.
    function dailyVolumeRemaining() external view returns (uint256) {
        return _volumeRemaining(mandate.getPolicy().maxDailyVolumeBps);
    }

    /// @notice Value of the portfolio, in stable units, at the last oracle prices. Money set aside for commitments is not included.
    function portfolioValue() public view returns (uint256 total) {
        (total,) = _values(false);
    }

    /// @notice Loss since the day-start snapshot, in basis points. Zero on a new day until the first snapshot.
    function drawdownBps() public view returns (uint256) {
        if (block.timestamp / 1 days != day) return 0;
        return _drawdownBps(portfolioValue());
    }

    function inProtectMode() external view returns (bool) {
        return block.timestamp < cooldownUntil || drawdownBps() >= mandate.getPolicy().dailyLossBps;
    }

    /// @notice Share of the portfolio in cash and defensive assets, in basis points.
    function defensiveBps() external view returns (uint256) {
        (uint256 total, uint256 defensive) = _values(false);
        return total == 0 ? BPS : defensive * BPS / total;
    }

    function exposureBps(address asset) external view returns (uint256) {
        uint256 total = portfolioValue();
        uint256 unit = mandate.unitOf(asset);
        if (total == 0 || holdings[asset] == 0 || unit == 0) return 0;
        return PriceMath.toStable(holdings[asset], _price(asset, false), unit, _stableUnit) * BPS / total;
    }

    /// @notice What the owner's wallet signs for a `TradeApproval`, under EIP-712.
    function approvalDigest(TradeApproval calldata a) public view returns (bytes32) {
        bytes32 structHash =
            keccak256(abi.encode(APPROVAL_TYPEHASH, a.action, a.assetIn, a.assetOut, a.amount, a.nonce, a.validFrom, a.expiry));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    /// @notice Binds an approval to this vault on this chain.
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("PolicyVault"), keccak256("1"), block.chainid, address(this)));
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// @param limited true for the agent alone, false for a trade the owner signed for
    function _buy(address asset, uint256 usdIn, bytes32 ref, bool limited) internal returns (uint256 out) {
        if (usdIn == 0) revert ZeroAmount();
        AssetRule memory rule = mandate.getRule(asset);
        if (!rule.allowed) revert AssetNotAllowed(asset);
        Policy memory p = mandate.getPolicy();
        uint256 value = _rollDay();
        if (limited) _useAgentLimits(usdIn, value, p);
        _requireNotProtected(value, p.dailyLossBps);
        uint256 price = _price(asset, true);
        if (price <= rule.stopPrice) revert BelowStopPrice(asset, price, rule.stopPrice);
        uint256 free = holdings[address(stable)] - reservedTotal;
        if (usdIn > free) revert InsufficientBalance(address(stable), usdIn, free);

        out = _swapBuy(asset, usdIn, price, p.maxSlippageBps);

        value = _requireWithinMandate(asset, price, rule, p.minDefensiveBps);
        emit Trade(asset, true, usdIn, out, price, ref, msg.sender);
        _latch(value, p);
    }

    function _requireNotProtected(uint256 value, uint256 dailyLossBps) internal view {
        if (block.timestamp < cooldownUntil) revert CooldownActive(cooldownUntil);
        uint256 drawdown = _drawdownBps(value);
        if (drawdown >= dailyLossBps) revert ExceedsDailyLoss(drawdown, dailyLossBps);
    }

    /// @dev The portfolio-level rules, checked on the state after a buy.
    function _requireWithinMandate(address asset, uint256 price, AssetRule memory rule, uint256 minDefensiveBps)
        internal
        view
        returns (uint256 total)
    {
        uint256 defensive;
        (total, defensive) = _values(true);
        uint256 exposure = PriceMath.toStable(holdings[asset], price, mandate.unitOf(asset), _stableUnit) * BPS / total;
        if (exposure > rule.maxExposureBps) revert ExceedsExposure(asset, exposure, rule.maxExposureBps);
        // buying a defensive asset with cash moves the defensive share only by the fee
        if (!rule.defensive) {
            uint256 share = defensive * BPS / total;
            if (share < minDefensiveBps) revert BelowDefensiveFloor(share, minDefensiveBps);
        }
    }

    function _sell(address asset, uint256 amount, bytes32 ref, bool limited) internal returns (uint256 out) {
        if (amount == 0) revert ZeroAmount();
        uint256 unit = mandate.unitOf(asset);
        if (unit == 0) revert UnknownAsset(asset);
        if (amount > holdings[asset]) revert InsufficientBalance(asset, amount, holdings[asset]);
        Policy memory p = mandate.getPolicy();
        uint256 value = _rollDay();
        uint256 price = _price(asset, true);
        // dust worth less than one stable unit would otherwise slip past the volume count
        uint256 usdValue = PriceMath.toStable(amount, price, unit, _stableUnit);
        if (usdValue == 0) revert ZeroAmount();
        if (limited) _useAgentLimits(usdValue, value, p);

        bool lost;
        (out, lost) = _swapSell(asset, amount, price, p.maxSlippageBps);
        emit Trade(asset, false, out, amount, price, ref, msg.sender);

        // a run of losing sells starts a cooldown, so losses cannot be chased with new buying
        if (!lost || p.maxLossStreak == 0) {
            lossStreak = 0;
        } else if (++lossStreak >= p.maxLossStreak) {
            lossStreak = 0;
            _startCooldown(Trigger.LossStreak, 0, p.cooldown);
        }
        _latch(_strictValue(), p);
    }

    function _sameDay() internal view returns (bool) {
        return block.timestamp / 1 days == day;
    }

    function _unreserve(uint256 id, uint256 amount) internal {
        reserved[id] -= amount;
        reservedTotal -= amount;
    }

    /// @dev Takes `amount` out of the reserves, commitment by commitment, for a withdrawal.
    function _drainReserves(uint256 amount) internal {
        uint256 n = mandate.commitmentCount();
        for (uint256 id = 1; id <= n && amount > 0; id++) {
            uint256 take = reserved[id] < amount ? reserved[id] : amount;
            if (take == 0) continue;
            _unreserve(id, take);
            amount -= take;
            emit Released(id, take);
        }
    }

    function _strictValue() internal view returns (uint256 total) {
        (total,) = _values(true);
    }

    /// @param value the portfolio's value before the trade
    function _useAgentLimits(uint256 usdAmount, uint256 value, Policy memory p) internal {
        uint256 limit = value * p.maxTradeBps / BPS;
        if (usdAmount > limit) revert ExceedsTradeLimit(usdAmount, limit);
        uint256 remaining = _volumeRemaining(p.maxDailyVolumeBps);
        if (usdAmount > remaining) revert ExceedsDailyVolume(usdAmount, remaining);
        volumeToday += usdAmount;
    }

    function _volumeRemaining(uint256 maxDailyVolumeBps) internal view returns (uint256) {
        bool sameDay = block.timestamp / 1 days == day;
        uint256 cap = (sameDay ? dayStartValue : portfolioValue()) * maxDailyVolumeBps / BPS;
        uint256 used = sameDay ? volumeToday : 0;
        return cap > used ? cap - used : 0;
    }

    /// @dev Balances are measured before and after, so the vault's books never
    /// depend on what the exchange reports.
    function _swapBuy(address asset, uint256 usdIn, uint256 price, uint256 maxSlippageBps)
        internal
        returns (uint256 received)
    {
        uint256 minOut =
            PriceMath.toAsset(usdIn, price, mandate.unitOf(asset), _stableUnit) * (BPS - maxSlippageBps) / BPS;
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
    function _swapSell(address asset, uint256 amount, uint256 price, uint256 maxSlippageBps)
        internal
        returns (uint256 received, bool lost)
    {
        uint256 minOut =
            PriceMath.toStable(amount, price, mandate.unitOf(asset), _stableUnit) * (BPS - maxSlippageBps) / BPS;
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
    function _latch(uint256 value, Policy memory p) internal {
        if (block.timestamp < cooldownUntil) return;
        uint256 drawdown = _drawdownBps(value);
        if (drawdown < p.dailyLossBps || drawdown == 0) return;
        _startCooldown(Trigger.DailyLoss, drawdown, p.cooldown);
    }

    function _startCooldown(Trigger trigger, uint256 drawdown, uint256 cooldown) internal {
        uint64 until = uint64(block.timestamp + cooldown);
        if (until > cooldownUntil) cooldownUntil = until;
        emit ProtectModeEntered(trigger, drawdown, cooldownUntil);
    }

    function _drawdownBps(uint256 value) internal view returns (uint256) {
        uint256 start = dayStartValue;
        if (start == 0 || value >= start) return 0;
        return (start - value) * BPS / start;
    }

    /// @return total value of everything held, in stable units
    /// @return defensive the part of it in cash and defensive assets
    function _values(bool strict) internal view returns (uint256 total, uint256 defensive) {
        // money set aside for commitments is not part of the portfolio
        total = holdings[address(stable)] - reservedTotal;
        defensive = total;
        (address[] memory assets, uint256[] memory units, bool[] memory isDefensive) = mandate.getAssetList();
        for (uint256 i = 0; i < assets.length; i++) {
            uint256 held = holdings[assets[i]];
            if (held == 0) continue;
            uint256 v = PriceMath.toStable(held, _price(assets[i], strict), units[i], _stableUnit);
            total += v;
            if (isDefensive[i]) defensive += v;
        }
    }

    function _isEmpty() internal view returns (bool) {
        if (holdings[address(stable)] != 0) return false;
        address[] memory assets = mandate.getAssets();
        for (uint256 i = 0; i < assets.length; i++) {
            if (holdings[assets[i]] != 0) return false;
        }
        return true;
    }

    function _valueOf(address token, uint256 amount) internal view returns (uint256) {
        if (token == address(stable)) return amount;
        return PriceMath.toStable(amount, _price(token, false), mandate.unitOf(token), _stableUnit);
    }

    /// @param strict revert if the price is older than maxPriceAge
    function _price(address asset, bool strict) internal view returns (uint256 price) {
        uint256 updatedAt;
        (price, updatedAt) = oracle.getPrice(asset);
        if (strict && block.timestamp > updatedAt + maxPriceAge) revert StalePrice(asset, updatedAt);
    }
}
