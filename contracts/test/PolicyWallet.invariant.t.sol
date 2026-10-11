// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyWallet} from "../src/PolicyWallet.sol";
import {TestUSD} from "../src/TestUSD.sol";

/// Plays a fully compromised agent: it holds the real agent key and fires
/// random calls at every function that key can reach, with random arguments.
contract CompromisedAgent is Test {
    PolicyWallet public wallet;
    TestUSD public token;
    address public agent;

    mapping(uint256 => uint256) public outflowByDay;
    uint256 public worstDayOutflow;
    uint256 public calls;

    constructor(PolicyWallet wallet_, TestUSD token_, address agent_) {
        wallet = wallet_;
        token = token_;
        agent = agent_;
    }

    function pay(uint256 mandateSeed, uint256 amount, bytes32 ref) external {
        uint256 id = bound(mandateSeed, 0, wallet.mandateCount() + 1);
        amount = bound(amount, 0, 20_000e6);
        uint256 before = token.balanceOf(address(wallet));
        vm.prank(agent);
        try wallet.pay(id, amount, ref) {} catch {}
        _record(before - token.balanceOf(address(wallet)));
    }

    /// The smartest attack available: take exactly as much as the limits allow, then try for one more.
    function drain(uint256 mandateSeed) external {
        uint256 id = bound(mandateSeed, 1, wallet.mandateCount());
        uint256 before = token.balanceOf(address(wallet));
        vm.startPrank(agent);
        for (uint256 i = 0; i < 4; i++) {
            uint256 amount = wallet.perTxCap();
            if (wallet.dailyRemaining() < amount) amount = wallet.dailyRemaining();
            if (wallet.mandateRemaining(id) < amount) amount = wallet.mandateRemaining(id);
            try wallet.pay(id, amount, bytes32(0)) {} catch {}
        }
        try wallet.pay(id, 1, bytes32(0)) {} catch {}
        vm.stopPrank();
        _record(before - token.balanceOf(address(wallet)));
    }

    function proposeAndPay(address payee, uint256 amount) external {
        vm.startPrank(agent);
        try wallet.proposeMandate(payee, 0, type(uint256).max, 1 days, type(uint64).max, "pay me") returns (
            uint256 id
        ) {
            try wallet.pay(id, bound(amount, 1, 20_000e6), bytes32(0)) {} catch {}
            try wallet.requestPayment(id, amount, bytes32(0)) {} catch {}
        } catch {}
        vm.stopPrank();
    }

    function moveFunds(uint256 from, uint256 to, uint256 amount) external {
        uint256 n = wallet.bucketCount();
        vm.prank(agent);
        try wallet.moveFunds(bound(from, 0, n), bound(to, 0, n), bound(amount, 0, 20_000e6)) {} catch {}
    }

    function callOwnerFunctions(uint256 amount) external {
        vm.startPrank(agent);
        try wallet.withdraw(0, amount) {} catch {}
        try wallet.proposeLimits(type(uint256).max, type(uint256).max) {} catch {}
        try wallet.applyLimits() {} catch {}
        try wallet.approveMandate(wallet.mandateCount()) {} catch {}
        try wallet.approveRequest(wallet.requestCount()) {} catch {}
        try wallet.setAgent(agent, type(uint64).max) {} catch {}
        vm.stopPrank();
    }

    function wait(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 8 hours));
    }

    function _record(uint256 out) internal {
        calls++;
        uint256 day = block.timestamp / 1 days;
        outflowByDay[day] += out;
        if (outflowByDay[day] > worstDayOutflow) worstDayOutflow = outflowByDay[day];
    }
}

contract PolicyWalletInvariantTest is Test {
    PolicyWallet wallet;
    TestUSD token;
    CompromisedAgent handler;

    address owner = makeAddr("owner");
    address guardian = makeAddr("guardian");
    address agent = makeAddr("agent");
    address uni = makeAddr("university");
    address landlord = makeAddr("landlord");

    uint256 constant FUNDS = 100_000e6;
    uint256 constant PER_TX = 2_000e6;
    uint256 constant DAILY = 3_000e6;

    function setUp() public {
        vm.warp(700 * 30 days);
        token = new TestUSD();
        wallet = new PolicyWallet(token, owner, guardian, PER_TX, DAILY, 1 days, 2 days);
        token.mint(address(wallet), FUNDS);

        vm.startPrank(owner);
        wallet.setAgent(agent, type(uint64).max);
        uint256 tuitionBucket = wallet.createBucket("Tuition", true);
        uint256 livingBucket = wallet.createBucket("Living", false);
        wallet.createMandate(uni, tuitionBucket, 50_000e6, 30 days, type(uint64).max, "Tuition");
        wallet.createMandate(landlord, livingBucket, 8_000e6, 30 days, type(uint64).max, "Rent");
        wallet.moveFunds(0, tuitionBucket, 60_000e6);
        wallet.moveFunds(0, livingBucket, 20_000e6);
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days);

        handler = new CompromisedAgent(wallet, token, agent);
        targetContract(address(handler));
    }

    /// Money only ever reaches the two approved payees. Not one unit goes anywhere else.
    function invariant_FundsOnlyReachApprovedPayees() public view {
        assertEq(token.balanceOf(address(wallet)) + token.balanceOf(uni) + token.balanceOf(landlord), FUNDS);
    }

    /// The compromised agent never moves more than the daily cap in one UTC day.
    function invariant_DailyOutflowNeverExceedsCap() public view {
        assertLe(handler.worstDayOutflow(), DAILY);
    }

    /// Bucket accounting never claims more than the wallet holds.
    function invariant_BucketsAreBacked() public view {
        assertLe(wallet.totalAllocated(), token.balanceOf(address(wallet)));
    }

    /// The agent cannot change its own limits or key.
    function invariant_PolicyIsUntouched() public view {
        assertEq(wallet.perTxCap(), PER_TX);
        assertEq(wallet.dailyCap(), DAILY);
        assertEq(wallet.agent(), agent);
        assertEq(wallet.mandateCount() >= 2, true);
    }
}
