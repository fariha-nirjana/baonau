// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PolicyWallet
/// @notice A wallet that assumes its AI agent is already compromised.
///
/// Three keys with deliberately unequal powers:
///   - owner    (the student)  sets policy and approves escalations
///   - guardian (the family)   can only say no: pause, veto, revoke
///   - agent    (the AI)       can only pay under mandates the owner approved
///
/// Rules the contract enforces regardless of what the agent was told:
///   1. Money only ever leaves to the payee of a mandate that has finished its
///      waiting period, or back to the owner. No agent function that moves
///      money takes an address.
///   2. Agent spending is bounded per transaction, per UTC day and per mandate.
///   3. Making the wallet stricter is instant. Making it looser (new payee,
///      higher limits) waits out a delay that the guardian can veto.
contract PolicyWallet is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum MandateStatus {
        None,
        Proposed, // suggested by the agent, waiting for the owner
        Approved, // approved by the owner, payable once activeFrom has passed
        Revoked
    }

    enum RequestStatus {
        None,
        Pending,
        Approved,
        Rejected
    }

    /// @notice A standing permission to pay one payee, like a direct debit mandate.
    struct Mandate {
        address payee;
        uint256 bucket;
        MandateStatus status;
        uint64 activeFrom;
        uint64 expiry;
        uint64 period;
        uint64 periodIndex;
        uint256 capPerPeriod;
        uint256 spentInPeriod;
        string purpose;
    }

    struct Bucket {
        string name;
        bool locked; // the agent can move money in, but out only through a mandate
        uint256 balance;
    }

    /// @notice A payment above the agent's limits, waiting for the owner.
    struct Request {
        uint256 mandateId;
        uint256 amount;
        bytes32 ref;
        RequestStatus status;
    }

    struct PendingLimits {
        uint256 perTxCap;
        uint256 dailyCap;
        uint64 eta;
    }

    uint256 public constant UNALLOCATED = 0;
    uint64 public constant MIN_PERIOD = 1 days;

    IERC20 public immutable token;
    address public immutable owner;
    uint64 public immutable mandateDelay;
    uint64 public immutable loosenDelay;

    address public guardian;
    address public agent;
    uint64 public agentExpiry;
    bool public paused;

    uint256 public perTxCap;
    uint256 public dailyCap;
    PendingLimits public pendingLimits;

    uint256 public totalAllocated;
    uint256 public mandateCount;
    uint256 public requestCount;

    uint256 private _spentDay;
    uint256 private _spentToday;
    Bucket[] private _buckets;
    mapping(uint256 => Mandate) private _mandates;
    mapping(uint256 => Request) private _requests;

    event MandateProposed(
        uint256 indexed id,
        address indexed payee,
        uint256 bucket,
        uint256 capPerPeriod,
        uint64 period,
        uint64 expiry,
        string purpose,
        address indexed by
    );
    event MandateApproved(uint256 indexed id, uint64 activeFrom);
    event MandateRevoked(uint256 indexed id, address indexed by);
    /// @param ref hash of the off-chain record (invoice, agent reasoning, policy decision)
    event Paid(
        uint256 indexed mandateId,
        address indexed payee,
        uint256 amount,
        uint256 bucket,
        bytes32 ref,
        address indexed by
    );
    event PaymentRequested(uint256 indexed requestId, uint256 indexed mandateId, uint256 amount, bytes32 ref);
    event RequestApproved(uint256 indexed requestId);
    event RequestRejected(uint256 indexed requestId, address indexed by);
    event LimitsProposed(uint256 perTxCap, uint256 dailyCap, uint64 eta);
    event LimitsChanged(uint256 perTxCap, uint256 dailyCap);
    event LimitsCancelled(address indexed by);
    event AgentSet(address indexed agent, uint64 expiry);
    event AgentRevoked(address indexed by);
    event Paused(address indexed by);
    event Unpaused();
    event BucketCreated(uint256 indexed id, string name, bool locked);
    event FundsMoved(uint256 indexed from, uint256 indexed to, uint256 amount, address indexed by);
    event Withdrawn(uint256 indexed bucket, uint256 amount);
    event GuardianChanged(address indexed from, address indexed to);

    error NotOwner();
    error NotGuardian();
    error NotOwnerOrGuardian();
    error NotAgent();
    error AgentKeyExpired();
    error WalletPaused();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidAgent();
    error InvalidPayee();
    error InvalidPeriod();
    error InvalidExpiry();
    error UnknownBucket(uint256 bucket);
    error SameBucket();
    error BucketLocked(uint256 bucket);
    error InsufficientBucket(uint256 bucket, uint256 amount, uint256 available);
    error MandateNotApproved(uint256 id);
    error MandateNotProposed(uint256 id);
    error MandateInWaitingPeriod(uint256 id, uint64 activeFrom);
    error MandateExpired(uint256 id);
    error OverPerTxCap(uint256 amount, uint256 cap);
    error OverDailyCap(uint256 amount, uint256 remaining);
    error OverMandateCap(uint256 id, uint256 amount, uint256 remaining);
    error RequestNotPending(uint256 id);
    error NoPendingLimits();
    error LimitsNotReady(uint64 eta);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOwnerOrGuardian() {
        if (msg.sender != owner && msg.sender != guardian) revert NotOwnerOrGuardian();
        _;
    }

    modifier onlyAgent() {
        _checkAgent();
        _;
    }

    constructor(
        IERC20 token_,
        address owner_,
        address guardian_,
        uint256 perTxCap_,
        uint256 dailyCap_,
        uint64 mandateDelay_,
        uint64 loosenDelay_
    ) {
        if (address(token_) == address(0) || owner_ == address(0) || guardian_ == address(0)) {
            revert ZeroAddress();
        }
        token = token_;
        owner = owner_;
        guardian = guardian_;
        perTxCap = perTxCap_;
        dailyCap = dailyCap_;
        mandateDelay = mandateDelay_;
        loosenDelay = loosenDelay_;
        _buckets.push(Bucket("Unallocated", false, 0));
        emit LimitsChanged(perTxCap_, dailyCap_);
    }

    // ------------------------------------------------------------------
    // Agent: the only functions the AI's key can call
    // ------------------------------------------------------------------

    /// @notice Pay the payee of a mandate. The agent names a mandate, never an address.
    function pay(uint256 mandateId, uint256 amount, bytes32 ref) external onlyAgent nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Mandate storage m = _mandates[mandateId];
        _requireActive(m, mandateId);

        if (amount > perTxCap) revert OverPerTxCap(amount, perTxCap);
        uint256 dayLeft = dailyRemaining();
        if (amount > dayLeft) revert OverDailyCap(amount, dayLeft);
        uint256 mandateLeft = mandateRemaining(mandateId);
        if (amount > mandateLeft) revert OverMandateCap(mandateId, amount, mandateLeft);

        uint256 day = block.timestamp / 1 days;
        if (day != _spentDay) {
            _spentDay = day;
            _spentToday = 0;
        }
        _spentToday += amount;

        uint64 idx = uint64(block.timestamp / m.period);
        if (idx != m.periodIndex) {
            m.periodIndex = idx;
            m.spentInPeriod = 0;
        }
        m.spentInPeriod += amount;

        _debit(m.bucket, amount);
        token.safeTransfer(m.payee, amount);
        emit Paid(mandateId, m.payee, amount, m.bucket, ref, msg.sender);
    }

    /// @notice Ask the owner to approve a payment that is above the agent's limits.
    function requestPayment(uint256 mandateId, uint256 amount, bytes32 ref)
        external
        onlyAgent
        returns (uint256 requestId)
    {
        if (amount == 0) revert ZeroAmount();
        if (_mandates[mandateId].status != MandateStatus.Approved) revert MandateNotApproved(mandateId);
        requestId = ++requestCount;
        _requests[requestId] = Request(mandateId, amount, ref, RequestStatus.Pending);
        emit PaymentRequested(requestId, mandateId, amount, ref);
    }

    /// @notice Suggest a new payee. Nothing is payable until the owner approves
    /// it and the waiting period has passed.
    function proposeMandate(
        address payee,
        uint256 bucket,
        uint256 capPerPeriod,
        uint64 period,
        uint64 expiry,
        string calldata purpose
    ) external onlyAgent returns (uint256 id) {
        id = _newMandate(payee, bucket, capPerPeriod, period, expiry, purpose);
    }

    /// @notice Move money between budget buckets. The agent cannot take money
    /// out of a locked bucket. The owner can move anything.
    function moveFunds(uint256 from, uint256 to, uint256 amount) external {
        if (msg.sender != owner) {
            _checkAgent();
            if (from < _buckets.length && _buckets[from].locked) revert BucketLocked(from);
        }
        if (amount == 0) revert ZeroAmount();
        if (from == to) revert SameBucket();
        if (to >= _buckets.length) revert UnknownBucket(to);
        _debit(from, amount);
        if (to != UNALLOCATED) {
            _buckets[to].balance += amount;
            totalAllocated += amount;
        }
        emit FundsMoved(from, to, amount, msg.sender);
    }

    // ------------------------------------------------------------------
    // Owner: policy and approvals
    // ------------------------------------------------------------------

    /// @notice Create a mandate directly. It still waits out the delay.
    function createMandate(
        address payee,
        uint256 bucket,
        uint256 capPerPeriod,
        uint64 period,
        uint64 expiry,
        string calldata purpose
    ) external onlyOwner returns (uint256 id) {
        id = _newMandate(payee, bucket, capPerPeriod, period, expiry, purpose);
        _approveMandate(id);
    }

    function approveMandate(uint256 id) external onlyOwner {
        if (_mandates[id].status != MandateStatus.Proposed) revert MandateNotProposed(id);
        _approveMandate(id);
    }

    /// @notice Approve a payment the agent could not make alone. It still goes
    /// only to the payee of an active mandate.
    function approveRequest(uint256 requestId) external onlyOwner nonReentrant {
        Request storage r = _requests[requestId];
        if (r.status != RequestStatus.Pending) revert RequestNotPending(requestId);
        Mandate storage m = _mandates[r.mandateId];
        _requireActive(m, r.mandateId);
        r.status = RequestStatus.Approved;
        _debit(m.bucket, r.amount);
        token.safeTransfer(m.payee, r.amount);
        emit RequestApproved(requestId);
        emit Paid(r.mandateId, m.payee, r.amount, m.bucket, r.ref, msg.sender);
    }

    /// @notice Change the agent's limits. Lower limits apply now. Higher limits
    /// wait for loosenDelay and can be vetoed by the guardian.
    function proposeLimits(uint256 newPerTxCap, uint256 newDailyCap) external onlyOwner {
        if (newPerTxCap <= perTxCap && newDailyCap <= dailyCap) {
            delete pendingLimits;
            perTxCap = newPerTxCap;
            dailyCap = newDailyCap;
            emit LimitsChanged(newPerTxCap, newDailyCap);
        } else {
            uint64 eta = uint64(block.timestamp) + loosenDelay;
            pendingLimits = PendingLimits(newPerTxCap, newDailyCap, eta);
            emit LimitsProposed(newPerTxCap, newDailyCap, eta);
        }
    }

    function applyLimits() external onlyOwner {
        PendingLimits memory p = pendingLimits;
        if (p.eta == 0) revert NoPendingLimits();
        if (block.timestamp < p.eta) revert LimitsNotReady(p.eta);
        delete pendingLimits;
        perTxCap = p.perTxCap;
        dailyCap = p.dailyCap;
        emit LimitsChanged(p.perTxCap, p.dailyCap);
    }

    /// @notice Give the agent a session key. Its powers stay bounded by the policy.
    function setAgent(address newAgent, uint64 expiry) external onlyOwner {
        if (newAgent == address(0) || newAgent == owner || newAgent == guardian) revert InvalidAgent();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        agent = newAgent;
        agentExpiry = expiry;
        emit AgentSet(newAgent, expiry);
    }

    function createBucket(string calldata name, bool locked) external onlyOwner returns (uint256 id) {
        id = _buckets.length;
        _buckets.push(Bucket(name, locked, 0));
        emit BucketCreated(id, name, locked);
    }

    /// @notice Take money out. It can only go to the owner's own address.
    function withdraw(uint256 bucket, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _debit(bucket, amount);
        token.safeTransfer(owner, amount);
        emit Withdrawn(bucket, amount);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused();
    }

    // ------------------------------------------------------------------
    // Owner or guardian: everything that makes the wallet stricter
    // ------------------------------------------------------------------

    function pause() external onlyOwnerOrGuardian {
        paused = true;
        emit Paused(msg.sender);
    }

    function revokeAgent() external onlyOwnerOrGuardian {
        agent = address(0);
        agentExpiry = 0;
        emit AgentRevoked(msg.sender);
    }

    function revokeMandate(uint256 id) external onlyOwnerOrGuardian {
        MandateStatus s = _mandates[id].status;
        if (s != MandateStatus.Proposed && s != MandateStatus.Approved) revert MandateNotApproved(id);
        _mandates[id].status = MandateStatus.Revoked;
        emit MandateRevoked(id, msg.sender);
    }

    function rejectRequest(uint256 requestId) external onlyOwnerOrGuardian {
        if (_requests[requestId].status != RequestStatus.Pending) revert RequestNotPending(requestId);
        _requests[requestId].status = RequestStatus.Rejected;
        emit RequestRejected(requestId, msg.sender);
    }

    function cancelLimits() external onlyOwnerOrGuardian {
        if (pendingLimits.eta == 0) revert NoPendingLimits();
        delete pendingLimits;
        emit LimitsCancelled(msg.sender);
    }

    /// @notice Only the guardian can hand the guardian role to someone else,
    /// so the owner cannot remove the veto.
    function transferGuardian(address newGuardian) external {
        if (msg.sender != guardian) revert NotGuardian();
        if (newGuardian == address(0)) revert ZeroAddress();
        emit GuardianChanged(guardian, newGuardian);
        guardian = newGuardian;
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Upper bound on what the agent key alone can still move today,
    /// even if it is fully compromised. Any of it can only reach mandate payees.
    function agentExposure() external view returns (uint256) {
        if (paused || agent == address(0) || block.timestamp >= agentExpiry) return 0;
        uint256 bal = token.balanceOf(address(this));
        uint256 dayLeft = dailyRemaining();
        return dayLeft < bal ? dayLeft : bal;
    }

    function dailyRemaining() public view returns (uint256) {
        uint256 spent = block.timestamp / 1 days == _spentDay ? _spentToday : 0;
        return dailyCap > spent ? dailyCap - spent : 0;
    }

    function mandateRemaining(uint256 id) public view returns (uint256) {
        Mandate storage m = _mandates[id];
        if (!isMandateActive(id)) return 0;
        uint256 spent = uint64(block.timestamp / m.period) == m.periodIndex ? m.spentInPeriod : 0;
        return m.capPerPeriod > spent ? m.capPerPeriod - spent : 0;
    }

    function isMandateActive(uint256 id) public view returns (bool) {
        Mandate storage m = _mandates[id];
        return m.status == MandateStatus.Approved && block.timestamp >= m.activeFrom && block.timestamp < m.expiry;
    }

    function unallocated() public view returns (uint256) {
        return token.balanceOf(address(this)) - totalAllocated;
    }

    function bucketBalance(uint256 bucket) public view returns (uint256) {
        if (bucket >= _buckets.length) revert UnknownBucket(bucket);
        return bucket == UNALLOCATED ? unallocated() : _buckets[bucket].balance;
    }

    function bucketCount() external view returns (uint256) {
        return _buckets.length;
    }

    function getBucket(uint256 bucket) external view returns (string memory name, bool locked, uint256 balance) {
        balance = bucketBalance(bucket);
        Bucket storage b = _buckets[bucket];
        return (b.name, b.locked, balance);
    }

    function getMandate(uint256 id) external view returns (Mandate memory) {
        return _mandates[id];
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _checkAgent() internal view {
        if (msg.sender != agent) revert NotAgent();
        if (block.timestamp >= agentExpiry) revert AgentKeyExpired();
        if (paused) revert WalletPaused();
    }

    function _newMandate(
        address payee,
        uint256 bucket,
        uint256 capPerPeriod,
        uint64 period,
        uint64 expiry,
        string calldata purpose
    ) internal returns (uint256 id) {
        if (payee == address(0) || payee == address(this)) revert InvalidPayee();
        if (bucket >= _buckets.length) revert UnknownBucket(bucket);
        if (capPerPeriod == 0) revert ZeroAmount();
        if (period < MIN_PERIOD) revert InvalidPeriod();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        id = ++mandateCount;
        Mandate storage m = _mandates[id];
        m.payee = payee;
        m.bucket = bucket;
        m.status = MandateStatus.Proposed;
        m.expiry = expiry;
        m.period = period;
        m.capPerPeriod = capPerPeriod;
        m.purpose = purpose;
        emit MandateProposed(id, payee, bucket, capPerPeriod, period, expiry, purpose, msg.sender);
    }

    function _approveMandate(uint256 id) internal {
        Mandate storage m = _mandates[id];
        uint64 activeFrom = uint64(block.timestamp) + mandateDelay;
        if (m.expiry <= activeFrom) revert InvalidExpiry();
        m.status = MandateStatus.Approved;
        m.activeFrom = activeFrom;
        emit MandateApproved(id, activeFrom);
    }

    function _requireActive(Mandate storage m, uint256 id) internal view {
        if (m.status != MandateStatus.Approved) revert MandateNotApproved(id);
        if (block.timestamp < m.activeFrom) revert MandateInWaitingPeriod(id, m.activeFrom);
        if (block.timestamp >= m.expiry) revert MandateExpired(id);
    }

    function _debit(uint256 bucket, uint256 amount) internal {
        uint256 available = bucketBalance(bucket);
        if (amount > available) revert InsufficientBucket(bucket, amount, available);
        if (bucket != UNALLOCATED) {
            _buckets[bucket].balance -= amount;
            totalAllocated -= amount;
        }
    }
}
