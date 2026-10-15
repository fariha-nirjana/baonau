// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {AssetRule, Commitment, Policy} from "./Types.sol";

/// @title Mandate
/// @notice The investment mandate: what the agent may do, who may change that,
/// and how fast. It holds no funds. One vault is bound to it for good and
/// checks every trade against it.
///
/// It governs two ways things go wrong:
///   - the agent goes wrong (a mistake, an injection, a stolen key). The agent
///     has no function here at all. It cannot change a rule or a key.
///   - the owner goes wrong (a decision made in a bad moment). Every change is
///     classified by the fixed rules below, never by a model:
///         lowers risk  -> applies at once
///         raises risk  -> waits `loosenDelay`, and the guardian can cancel it
///     A change with any part that raises risk waits as a whole.
///
///   Change                                      Lowers risk        Raises risk
///   trade, volume, loss, slippage, asset cap    decrease           increase
///   minimum defensive share, cooldown           increase           decrease
///   losing-streak count                         smaller            larger, or off
///   asset on the allowlist, counted defensive   remove             add
///   stop price                                  raise              lower, or none
///   waiting period itself                       longer             shorter
///   agent key                                   revoke, shorten    new key, extend
///   guardian                                    add                remove, change
///   withdrawal address                          (never)            any change
///   halting the stop-loss                       (never)            owner asks
///   pausing the agent                           always             lifting a guardian's pause
///   a commitment                                remove, lower,     new payee, raise,
///                                               less often, later  more often, earlier, wider window
///   money set aside for one (in the vault)      add                release to investing
///
/// The guardian can only say no: pause, cancel, revoke, and halt the stop-loss
/// at once when the price feed breaks. It cannot cancel its own removal, so an
/// owner is never bound to a guardian for good.
contract Mandate is Initializable {
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_ASSETS = 8;
    uint16 public constant MAX_SLIPPAGE_BPS = 500;
    uint32 public constant MAX_COOLDOWN = 30 days;
    uint64 public constant MAX_AGENT_SESSION = 90 days;
    uint64 public constant MIN_DELAY = 1 minutes;
    uint64 public constant MAX_DELAY = 30 days;
    /// @notice A stop-loss halt lapses on its own, so protection cannot be switched off and forgotten.
    uint64 public constant MAX_HALT = 3 days;
    uint256 public constant MAX_COMMITMENTS = 8;
    uint32 public constant MIN_WINDOW = 1 hours;
    uint32 public constant MAX_WINDOW = 31 days;

    // Keys in `pendingEta` for changes that wait. An asset rule uses the asset's address as its key.
    bytes32 public constant POLICY_CHANGE = "policy";
    bytes32 public constant HALT_CHANGE = "stop-loss halt";
    bytes32 public constant WITHDRAWAL_CHANGE = "withdrawal address";
    bytes32 public constant AGENT_CHANGE = "agent key";
    bytes32 public constant GUARDIAN_CHANGE = "guardian";
    bytes32 public constant DELAY_CHANGE = "waiting period";
    bytes32 public constant UNPAUSE_CHANGE = "unpause";

    address public owner;
    /// @notice The one vault this mandate governs. Set when both are created and never changed.
    address public vault;
    IPriceOracle public oracle;
    address public stable;

    address public guardian;
    address public agent;
    uint64 public agentExpiry;

    /// @notice How long a change that raises risk waits.
    uint64 public loosenDelay;
    /// @notice The first mandate cannot be signed before this. Later vaults of one owner start with a wait.
    uint64 public activeFrom;
    /// @notice True once the owner has signed the first mandate.
    bool public signed;
    bool public paused;
    /// @notice A guardian's pause is lifted by the guardian, or by the owner only after the wait.
    bool public pausedByGuardian;
    uint64 public stopLossHaltedUntil;
    /// @notice Where the vault sends withdrawals. Starts as the owner's address.
    address public withdrawalAddress;

    Policy private _policy;
    address[] private _assets;
    mapping(address => AssetRule) private _rules;
    mapping(address => uint256) public unitOf;

    /// @notice When each waiting change may be applied. Zero means nothing is waiting.
    mapping(bytes32 => uint64) public pendingEta;
    Policy private _pendingPolicy;
    mapping(address => AssetRule) private _pendingRules;
    address public pendingWithdrawalAddress;
    address public pendingAgent;
    uint64 public pendingAgentExpiry;
    address public pendingGuardian;
    uint64 public pendingLoosenDelay;

    /// @notice Commitments are numbered from 1. A number is taken when one is first proposed.
    uint256 public commitmentCount;
    mapping(uint256 => Commitment) private _commitments;
    mapping(uint256 => Commitment) private _pendingCommitments;

    event MandateSigned();
    event PolicyProposed(Policy policy, uint64 eta);
    event PolicyChanged(Policy policy);
    event AssetRuleProposed(address indexed asset, AssetRule rule, uint64 eta);
    event AssetRuleChanged(address indexed asset, AssetRule rule);
    event AgentProposed(address indexed agent, uint64 expiry, uint64 eta);
    event AgentSet(address indexed agent, uint64 expiry);
    event AgentRevoked(address indexed by);
    event GuardianProposed(address indexed guardian, uint64 eta);
    event GuardianChanged(address indexed from, address indexed to);
    event LoosenDelayProposed(uint64 delay, uint64 eta);
    event LoosenDelayChanged(uint64 delay);
    event WithdrawalAddressProposed(address indexed to, uint64 eta);
    event WithdrawalAddressChanged(address indexed to);
    event StopLossHaltProposed(uint64 eta);
    event StopLossHalted(address indexed by, uint64 until);
    event StopLossResumed(address indexed by);
    event Paused(address indexed by);
    event UnpauseProposed(uint64 eta);
    event Unpaused(address indexed by);
    event ChangeCancelled(bytes32 indexed key, address indexed by);
    event CommitmentProposed(uint256 indexed id, Commitment commitment, uint64 eta);
    event CommitmentChanged(uint256 indexed id, Commitment commitment);
    event CommitmentScheduleAdvanced(uint256 indexed id, uint64 paidDue, uint64 nextDue);
    event Terminated();

    error NotOwner();
    error NotOwnerOrGuardian();
    error NotVault();
    error NotAgent();
    error AgentKeyExpired();
    error AgentPaused();
    error AlreadySigned();
    error NotActiveYet(uint64 activeFrom);
    error ZeroAddress();
    error InvalidAddress();
    error InvalidExpiry();
    error InvalidPolicy();
    error InvalidDelay();
    error LengthMismatch();
    error TooManyAssets();
    error NotAnAsset(address token);
    error NotVetoable();
    error NoPendingChange();
    error ChangeNotReady(uint64 eta);
    error InvalidCommitment();
    error TooManyCommitments();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOwnerOrGuardian() {
        if (msg.sender != owner && msg.sender != guardian) revert NotOwnerOrGuardian();
        _;
    }

    /// @dev The template that vaults are copied from can never be set up itself.
    constructor() {
        _disableInitializers();
    }

    /// @notice Called once by the factory, in the transaction that creates the copy.
    /// @param guardian_ may be zero; the owner can appoint one later
    function init(
        address owner_,
        address guardian_,
        address vault_,
        address stable_,
        IPriceOracle oracle_,
        uint64 loosenDelay_,
        uint64 activeFrom_
    ) external initializer {
        if (owner_ == address(0) || vault_ == address(0) || stable_ == address(0) || address(oracle_) == address(0)) {
            revert ZeroAddress();
        }
        if (guardian_ == owner_) revert InvalidAddress();
        if (loosenDelay_ < MIN_DELAY || loosenDelay_ > MAX_DELAY) revert InvalidDelay();
        owner = owner_;
        withdrawalAddress = owner_;
        guardian = guardian_;
        vault = vault_;
        stable = stable_;
        oracle = oracle_;
        loosenDelay = loosenDelay_;
        activeFrom = activeFrom_;
    }

    // ------------------------------------------------------------------
    // Owner: the first mandate, signed once
    // ------------------------------------------------------------------

    /// @notice Sign the first mandate and give the agent its key. Works once.
    /// Everything after this follows the table at the top.
    function signMandate(
        Policy calldata p,
        address[] calldata assets,
        AssetRule[] calldata rules,
        address agent_,
        uint64 agentExpiry_
    ) external onlyOwner {
        if (signed) revert AlreadySigned();
        if (block.timestamp < activeFrom) revert NotActiveYet(activeFrom);
        if (assets.length != rules.length) revert LengthMismatch();
        _validate(p);
        signed = true;
        _policy = p;
        emit PolicyChanged(p);
        for (uint256 i = 0; i < assets.length; i++) {
            _validateRule(assets[i], rules[i]);
            _setRule(assets[i], rules[i]);
        }
        _validateAgent(agent_, agentExpiry_);
        _setAgent(agent_, agentExpiry_);
        emit MandateSigned();
    }

    // ------------------------------------------------------------------
    // Owner: changes. Each one applies now or waits, by the fixed rules.
    // ------------------------------------------------------------------

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

    /// @notice Give the agent a key. Shortening the current key's life applies
    /// now. A new key or a longer life waits.
    function setAgent(address newAgent, uint64 expiry) external onlyOwner {
        _validateAgent(newAgent, expiry);
        if (newAgent == agent && expiry <= agentExpiry) {
            delete pendingEta[AGENT_CHANGE];
            _setAgent(newAgent, expiry);
        } else {
            pendingAgent = newAgent;
            pendingAgentExpiry = expiry;
            emit AgentProposed(newAgent, expiry, _queue(AGENT_CHANGE));
        }
    }

    function applyAgent() external onlyOwner {
        _take(AGENT_CHANGE);
        _setAgent(pendingAgent, pendingAgentExpiry);
    }

    /// @notice Appointing a guardian where there is none applies now. Removing
    /// or replacing one waits, and that wait is the one change the guardian
    /// cannot cancel. Pass zero to remove.
    function setGuardian(address newGuardian) external onlyOwner {
        if (newGuardian == owner || (newGuardian != address(0) && newGuardian == agent)) revert InvalidAddress();
        if (guardian == address(0)) {
            if (newGuardian == address(0)) revert ZeroAddress();
            _setGuardian(newGuardian);
        } else {
            pendingGuardian = newGuardian;
            emit GuardianProposed(newGuardian, _queue(GUARDIAN_CHANGE));
        }
    }

    function applyGuardian() external onlyOwner {
        _take(GUARDIAN_CHANGE);
        _setGuardian(pendingGuardian);
    }

    /// @notice Change the waiting period itself. Longer applies now, shorter waits out the current one.
    function setLoosenDelay(uint64 newDelay) external onlyOwner {
        if (newDelay < MIN_DELAY || newDelay > MAX_DELAY) revert InvalidDelay();
        if (newDelay >= loosenDelay) {
            delete pendingEta[DELAY_CHANGE];
            loosenDelay = newDelay;
            emit LoosenDelayChanged(newDelay);
        } else {
            pendingLoosenDelay = newDelay;
            emit LoosenDelayProposed(newDelay, _queue(DELAY_CHANGE));
        }
    }

    function applyLoosenDelay() external onlyOwner {
        _take(DELAY_CHANGE);
        loosenDelay = pendingLoosenDelay;
        emit LoosenDelayChanged(loosenDelay);
    }

    /// @notice Ask to move the withdrawal address. It always waits.
    function proposeWithdrawalAddress(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (to == agent || to == vault || to == address(this)) revert InvalidAddress();
        pendingWithdrawalAddress = to;
        emit WithdrawalAddressProposed(to, _queue(WITHDRAWAL_CHANGE));
    }

    function applyWithdrawalAddress() external onlyOwner {
        _take(WITHDRAWAL_CHANGE);
        withdrawalAddress = pendingWithdrawalAddress;
        emit WithdrawalAddressChanged(withdrawalAddress);
    }

    /// @notice Add or change a commitment. Pass `commitmentCount() + 1` for a new one.
    /// Before the mandate is signed every commitment applies at once, as part of the
    /// first mandate. After that a commitment that lowers risk applies at once and
    /// one that raises it waits. A reserve with no payee always applies at once:
    /// setting money aside only leaves less to invest.
    function proposeCommitment(uint256 id, Commitment calldata b) external onlyOwner {
        if (id == 0 || id > commitmentCount + 1) revert InvalidCommitment();
        if (id > commitmentCount) {
            if (id > MAX_COMMITMENTS) revert TooManyCommitments();
            commitmentCount = id;
        }
        _validateCommitment(b);
        Commitment memory cur = _commitments[id];
        bytes32 key = commitmentKey(id);
        if (!signed || _commitmentTighter(cur, b)) {
            delete pendingEta[key];
            _setCommitment(id, b);
        } else {
            _pendingCommitments[id] = b;
            emit CommitmentProposed(id, b, _queue(key));
        }
    }

    function applyCommitment(uint256 id) external onlyOwner {
        _take(commitmentKey(id));
        _setCommitment(id, _pendingCommitments[id]);
    }

    function applyStopLossHalt() external onlyOwner {
        _take(HALT_CHANGE);
        _haltStopLoss();
    }

    function applyUnpause() external onlyOwner {
        _take(UNPAUSE_CHANGE);
        _unpause();
    }

    // ------------------------------------------------------------------
    // Owner or guardian
    // ------------------------------------------------------------------

    /// @notice Stop the agent, at once. The stop-loss keeps working.
    function pause() external onlyOwnerOrGuardian {
        paused = true;
        if (msg.sender == guardian) pausedByGuardian = true;
        emit Paused(msg.sender);
    }

    /// @notice Let the agent trade again. The guardian can always do this. The
    /// owner can undo their own pause at once; lifting a guardian's pause waits.
    function unpause() external onlyOwnerOrGuardian {
        if (msg.sender == guardian || !pausedByGuardian) _unpause();
        else emit UnpauseProposed(_queue(UNPAUSE_CHANGE));
    }

    function revokeAgent() external onlyOwnerOrGuardian {
        _revokeAgent();
        emit AgentRevoked(msg.sender);
    }

    /// @notice Stop the public stop-loss, for example when the price feed is
    /// wrong. From the guardian it applies now. From the owner it waits, so an
    /// owner who wants to "hold on, it will come back" in a crash cannot
    /// switch their own protection off.
    function haltStopLoss() external onlyOwnerOrGuardian {
        if (msg.sender == guardian) _haltStopLoss();
        else emit StopLossHaltProposed(_queue(HALT_CHANGE));
    }

    function resumeStopLoss() external onlyOwnerOrGuardian {
        stopLossHaltedUntil = 0;
        delete pendingEta[HALT_CHANGE];
        emit StopLossResumed(msg.sender);
    }

    /// @notice Drop a change that is waiting. This is the guardian's veto. The
    /// one thing the guardian cannot cancel is its own removal or replacement.
    /// @param key one of the `_CHANGE` constants, or `ruleKey(asset)`
    function cancelChange(bytes32 key) external onlyOwnerOrGuardian {
        if (pendingEta[key] == 0) revert NoPendingChange();
        if (key == GUARDIAN_CHANGE && msg.sender != owner) revert NotVetoable();
        delete pendingEta[key];
        emit ChangeCancelled(key, msg.sender);
    }

    // ------------------------------------------------------------------
    // The vault
    // ------------------------------------------------------------------

    /// @notice Called by the vault when the owner has withdrawn everything.
    /// The mandate ends: the agent's key is revoked. Starting again means a
    /// new key, which waits like any other.
    function terminate() external {
        if (msg.sender != vault) revert NotVault();
        _revokeAgent();
        emit Terminated();
    }

    /// @notice Called by the vault when the owner asks to move money set aside
    /// for a commitment back into investing. It waits, and the guardian can cancel it.
    function queueRelease(uint256 id) external returns (uint64) {
        if (msg.sender != vault) revert NotVault();
        return _queue(releaseKey(id));
    }

    /// @notice Called by the vault to apply a release. Reverts unless it has waited out its delay.
    function takeRelease(uint256 id) external {
        if (msg.sender != vault) revert NotVault();
        _take(releaseKey(id));
    }

    /// @notice Called by the vault after a commitment is paid. A payment counts for
    /// the current due date, so the same date can never be paid twice. A single
    /// payment closes the commitment.
    function markPaid(uint256 id) external {
        if (msg.sender != vault) revert NotVault();
        Commitment storage b = _commitments[id];
        uint64 paid = b.nextDue;
        if (b.period == 0) b.active = false;
        else b.nextDue = paid + b.period;
        emit CommitmentScheduleAdvanced(id, paid, b.nextDue);
    }

    /// @notice Reverts unless `who` is the agent, with a live key, and not paused.
    function requireAgent(address who) external view {
        if (who != agent || who == address(0)) revert NotAgent();
        if (block.timestamp >= agentExpiry) revert AgentKeyExpired();
        if (paused) revert AgentPaused();
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function ruleKey(address asset) public pure returns (bytes32) {
        return bytes32(uint256(uint160(asset)));
    }

    function commitmentKey(uint256 id) public pure returns (bytes32) {
        return keccak256(abi.encode("commitment", id));
    }

    function releaseKey(uint256 id) public pure returns (bytes32) {
        return keccak256(abi.encode("release", id));
    }

    function getCommitment(uint256 id) external view returns (Commitment memory) {
        return _commitments[id];
    }

    /// @notice The commitment that is waiting, if `pendingEta(commitmentKey(id))` is not zero.
    function getPendingCommitment(uint256 id) external view returns (Commitment memory) {
        return _pendingCommitments[id];
    }

    /// @notice True while the agent has a live key and is not paused.
    function agentActive() external view returns (bool) {
        return agent != address(0) && block.timestamp < agentExpiry && !paused;
    }

    function getPolicy() external view returns (Policy memory) {
        return _policy;
    }

    function getRule(address asset) external view returns (AssetRule memory) {
        return _rules[asset];
    }

    function getAssets() external view returns (address[] memory) {
        return _assets;
    }

    /// @notice Every listed asset with what the vault needs to value the portfolio.
    function getAssetList() external view returns (address[] memory assets, uint256[] memory units, bool[] memory defensive) {
        assets = _assets;
        units = new uint256[](assets.length);
        defensive = new bool[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            units[i] = unitOf[assets[i]];
            defensive[i] = _rules[assets[i]].defensive;
        }
    }

    /// @notice The mandate that is waiting, if `pendingEta(POLICY_CHANGE)` is not zero.
    function getPendingPolicy() external view returns (Policy memory) {
        return _pendingPolicy;
    }

    /// @notice The rule that is waiting, if `pendingEta(ruleKey(asset))` is not zero.
    function getPendingRule(address asset) external view returns (AssetRule memory) {
        return _pendingRules[asset];
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

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

    function _setAgent(address newAgent, uint64 expiry) internal {
        agent = newAgent;
        agentExpiry = expiry;
        emit AgentSet(newAgent, expiry);
    }

    function _revokeAgent() internal {
        agent = address(0);
        agentExpiry = 0;
        delete pendingEta[AGENT_CHANGE];
    }

    function _setGuardian(address newGuardian) internal {
        emit GuardianChanged(guardian, newGuardian);
        guardian = newGuardian;
    }

    function _haltStopLoss() internal {
        stopLossHaltedUntil = uint64(block.timestamp) + MAX_HALT;
        emit StopLossHalted(msg.sender, stopLossHaltedUntil);
    }

    function _unpause() internal {
        paused = false;
        pausedByGuardian = false;
        delete pendingEta[UNPAUSE_CHANGE];
        emit Unpaused(msg.sender);
    }

    function _validateAgent(address newAgent, uint64 expiry) internal view {
        if (newAgent == address(0)) revert ZeroAddress();
        if (newAgent == owner || newAgent == guardian || newAgent == vault) revert InvalidAddress();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_AGENT_SESSION) revert InvalidExpiry();
    }

    function _validate(Policy calldata p) internal pure {
        if (
            p.maxTradeBps > BPS || p.dailyLossBps > BPS || p.minDefensiveBps > BPS
                || p.maxSlippageBps > MAX_SLIPPAGE_BPS || p.cooldown > MAX_COOLDOWN
        ) revert InvalidPolicy();
    }

    function _validateRule(address asset, AssetRule calldata rule) internal view {
        if (asset == address(0)) revert ZeroAddress();
        if (asset == stable) revert NotAnAsset(asset);
        if (rule.maxExposureBps > BPS) revert InvalidPolicy();
        // reverts if the oracle has no feed for it
        oracle.getPrice(asset);
    }

    function _validateCommitment(Commitment calldata b) internal view {
        if (!b.active || b.payee == address(0)) return;
        if (b.payee == owner || b.payee == agent || b.payee == vault || b.payee == address(this)) revert InvalidAddress();
        if (b.maxAmount == 0 || b.nextDue == 0 || b.window < MIN_WINDOW || b.window > MAX_WINDOW) revert InvalidCommitment();
        if (b.period != 0 && b.window > b.period) revert InvalidCommitment();
    }

    /// @dev Lowers risk: ends the commitment, or keeps its payee and pays no more, no
    /// more often, no earlier and in no wider a window. A reserve with no payee never raises risk.
    function _commitmentTighter(Commitment memory cur, Commitment calldata b) internal pure returns (bool) {
        if (!b.active || b.payee == address(0)) return true;
        if (!cur.active || cur.payee != b.payee) return false;
        bool lessOften = b.period == 0 || (cur.period != 0 && b.period >= cur.period);
        return lessOften && b.maxAmount <= cur.maxAmount && b.window <= cur.window && b.nextDue >= cur.nextDue;
    }

    function _setCommitment(uint256 id, Commitment memory b) internal {
        _commitments[id] = b;
        emit CommitmentChanged(id, b);
    }

    function _setRule(address asset, AssetRule memory rule) internal {
        if (unitOf[asset] == 0) {
            if (_assets.length == MAX_ASSETS) revert TooManyAssets();
            unitOf[asset] = 10 ** IERC20Metadata(asset).decimals();
            _assets.push(asset);
        }
        _rules[asset] = rule;
        emit AssetRuleChanged(asset, rule);
    }
}
