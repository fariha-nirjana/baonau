// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyWallet} from "../src/PolicyWallet.sol";
import {TestUSD} from "../src/TestUSD.sol";

contract PolicyWalletTest is Test {
    PolicyWallet wallet;
    TestUSD token;

    address owner = makeAddr("owner");
    address guardian = makeAddr("guardian");
    address agent = makeAddr("agent");
    address uni = makeAddr("university");
    address landlord = makeAddr("landlord");
    address attacker = makeAddr("attacker");

    uint256 constant USD = 1e6;
    uint256 constant PER_TX = 2_000 * USD;
    uint256 constant DAILY = 3_000 * USD;
    uint64 constant MANDATE_DELAY = 1 days;
    uint64 constant LOOSEN_DELAY = 2 days;
    // aligned to the start of a day and of a 30 day period
    uint256 constant START = 700 * 30 days;
    bytes32 constant REF = keccak256("invoice-001");

    uint256 tuitionBucket;
    uint256 rentBucket;
    uint256 livingBucket;
    uint256 tuition;
    uint256 rent;

    function setUp() public {
        vm.warp(START);
        token = new TestUSD();
        wallet = new PolicyWallet(token, owner, guardian, PER_TX, DAILY, MANDATE_DELAY, LOOSEN_DELAY);
        token.mint(address(wallet), 10_000 * USD);

        vm.startPrank(owner);
        wallet.setAgent(agent, uint64(START + 365 days));
        tuitionBucket = wallet.createBucket("Tuition", true);
        rentBucket = wallet.createBucket("Rent", true);
        livingBucket = wallet.createBucket("Living", false);
        tuition = wallet.createMandate(uni, tuitionBucket, 5_000 * USD, 30 days, uint64(START + 365 days), "Tuition");
        rent = wallet.createMandate(landlord, rentBucket, 800 * USD, 30 days, uint64(START + 365 days), "Rent");
        wallet.moveFunds(0, tuitionBucket, 6_000 * USD);
        wallet.moveFunds(0, rentBucket, 1_600 * USD);
        vm.stopPrank();

        vm.warp(START + MANDATE_DELAY);
    }

    function _pay(uint256 id, uint256 amount) internal {
        vm.prank(agent);
        wallet.pay(id, amount, REF);
    }

    // ---------------- agent: allowed ----------------

    function test_AgentPaysWithinMandate() public {
        vm.expectEmit(true, true, true, true);
        emit PolicyWallet.Paid(tuition, uni, 1_500 * USD, tuitionBucket, REF, agent);
        _pay(tuition, 1_500 * USD);

        assertEq(token.balanceOf(uni), 1_500 * USD);
        assertEq(wallet.bucketBalance(tuitionBucket), 4_500 * USD);
        assertEq(wallet.dailyRemaining(), DAILY - 1_500 * USD);
        assertEq(wallet.mandateRemaining(tuition), 3_500 * USD);
    }

    function test_DailyCapResetsNextDay() public {
        _pay(tuition, 2_000 * USD);
        _pay(tuition, 1_000 * USD);
        assertEq(wallet.dailyRemaining(), 0);
        vm.warp(block.timestamp + 1 days);
        assertEq(wallet.dailyRemaining(), DAILY);
        _pay(rent, 800 * USD);
        assertEq(token.balanceOf(landlord), 800 * USD);
    }

    function test_MandateCapResetsNextPeriod() public {
        _pay(rent, 800 * USD);
        assertEq(wallet.mandateRemaining(rent), 0);
        vm.warp(block.timestamp + 30 days);
        assertEq(wallet.mandateRemaining(rent), 800 * USD);
        _pay(rent, 800 * USD);
        assertEq(token.balanceOf(landlord), 1_600 * USD);
    }

    // ---------------- agent: blocked ----------------

    function test_RevertWhen_CallerIsNotAgent() public {
        vm.expectRevert(PolicyWallet.NotAgent.selector);
        vm.prank(attacker);
        wallet.pay(tuition, 1 * USD, REF);
    }

    function test_RevertWhen_AgentKeyExpired() public {
        vm.warp(START + 365 days);
        vm.expectRevert(PolicyWallet.AgentKeyExpired.selector);
        _pay(tuition, 1 * USD);
    }

    function test_RevertWhen_AgentRevoked() public {
        vm.prank(guardian);
        wallet.revokeAgent();
        vm.expectRevert(PolicyWallet.NotAgent.selector);
        _pay(tuition, 1 * USD);
    }

    function test_RevertWhen_ZeroAmount() public {
        vm.expectRevert(PolicyWallet.ZeroAmount.selector);
        _pay(tuition, 0);
    }

    function test_RevertWhen_OverPerTxCap() public {
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.OverPerTxCap.selector, PER_TX + 1, PER_TX));
        _pay(tuition, PER_TX + 1);
    }

    function test_RevertWhen_OverDailyCap() public {
        _pay(tuition, 2_000 * USD);
        _pay(tuition, 500 * USD);
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.OverDailyCap.selector, 800 * USD, 500 * USD));
        _pay(rent, 800 * USD);
    }

    function test_RevertWhen_OverMandateCap() public {
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.OverMandateCap.selector, rent, 801 * USD, 800 * USD));
        _pay(rent, 801 * USD);
    }

    function test_RevertWhen_MandateInWaitingPeriod() public {
        vm.prank(owner);
        uint256 id = wallet.createMandate(attacker, 0, 100 * USD, 30 days, uint64(block.timestamp + 90 days), "New");
        uint64 activeFrom = uint64(block.timestamp) + MANDATE_DELAY;
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.MandateInWaitingPeriod.selector, id, activeFrom));
        _pay(id, 1 * USD);

        vm.warp(activeFrom);
        _pay(id, 1 * USD);
    }

    function test_RevertWhen_MandateExpired() public {
        vm.prank(owner);
        wallet.setAgent(agent, uint64(START + 800 days));
        vm.warp(START + 365 days);
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.MandateExpired.selector, tuition));
        _pay(tuition, 1 * USD);
    }

    function test_RevertWhen_MandateRevoked() public {
        vm.prank(guardian);
        wallet.revokeMandate(tuition);
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.MandateNotApproved.selector, tuition));
        _pay(tuition, 1 * USD);
    }

    function test_RevertWhen_MandateDoesNotExist() public {
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.MandateNotApproved.selector, 99));
        _pay(99, 1 * USD);
    }

    /// The injection scenario: the agent adds the attacker as a payee and tries to pay it.
    function test_RevertWhen_AgentPaysItsOwnProposedMandate() public {
        vm.prank(agent);
        uint256 id =
            wallet.proposeMandate(attacker, 0, 10_000 * USD, 1 days, uint64(block.timestamp + 30 days), "Urgent fee");
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.MandateNotApproved.selector, id));
        _pay(id, 1 * USD);

        vm.warp(block.timestamp + 10 days);
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.MandateNotApproved.selector, id));
        _pay(id, 1 * USD);
        assertEq(token.balanceOf(attacker), 0);
    }

    function test_RevertWhen_BucketHasTooLittle() public {
        vm.prank(owner);
        wallet.withdraw(rentBucket, 1_500 * USD);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyWallet.InsufficientBucket.selector, rentBucket, 800 * USD, 100 * USD)
        );
        _pay(rent, 800 * USD);
    }

    function test_RevertWhen_Paused() public {
        vm.prank(guardian);
        wallet.pause();
        vm.expectRevert(PolicyWallet.WalletPaused.selector);
        _pay(tuition, 1 * USD);

        vm.prank(owner);
        wallet.unpause();
        _pay(tuition, 1 * USD);
    }

    function test_AgentCannotCallOwnerFunctions() public {
        vm.startPrank(agent);
        vm.expectRevert(PolicyWallet.NotOwner.selector);
        wallet.withdraw(0, 1 * USD);
        vm.expectRevert(PolicyWallet.NotOwner.selector);
        wallet.createMandate(attacker, 0, 1 * USD, 1 days, uint64(block.timestamp + 30 days), "x");
        vm.expectRevert(PolicyWallet.NotOwner.selector);
        wallet.approveMandate(1);
        vm.expectRevert(PolicyWallet.NotOwner.selector);
        wallet.approveRequest(1);
        vm.expectRevert(PolicyWallet.NotOwner.selector);
        wallet.proposeLimits(type(uint256).max, type(uint256).max);
        vm.expectRevert(PolicyWallet.NotOwner.selector);
        wallet.applyLimits();
        vm.expectRevert(PolicyWallet.NotOwner.selector);
        wallet.setAgent(attacker, uint64(block.timestamp + 1 days));
        vm.expectRevert(PolicyWallet.NotOwner.selector);
        wallet.createBucket("x", false);
        vm.expectRevert(PolicyWallet.NotOwner.selector);
        wallet.unpause();
        vm.expectRevert(PolicyWallet.NotGuardian.selector);
        wallet.transferGuardian(attacker);
        vm.stopPrank();
    }

    // ---------------- guardian: can only say no ----------------

    function test_GuardianCannotMoveMoneyOrLoosen() public {
        vm.startPrank(guardian);
        vm.expectRevert(PolicyWallet.NotOwner.selector);
        wallet.withdraw(0, 1 * USD);
        vm.expectRevert(PolicyWallet.NotAgent.selector);
        wallet.pay(tuition, 1 * USD, REF);
        vm.expectRevert(PolicyWallet.NotAgent.selector);
        wallet.moveFunds(0, livingBucket, 1 * USD);
        vm.expectRevert(PolicyWallet.NotOwner.selector);
        wallet.createMandate(attacker, 0, 1 * USD, 1 days, uint64(block.timestamp + 30 days), "x");
        vm.expectRevert(PolicyWallet.NotOwner.selector);
        wallet.proposeLimits(type(uint256).max, type(uint256).max);
        vm.expectRevert(PolicyWallet.NotOwner.selector);
        wallet.setAgent(attacker, uint64(block.timestamp + 1 days));
        vm.expectRevert(PolicyWallet.NotOwner.selector);
        wallet.unpause();
        vm.stopPrank();
    }

    function test_GuardianVetoesNewPayeeDuringWaitingPeriod() public {
        vm.prank(owner);
        uint256 id = wallet.createMandate(attacker, 0, 100 * USD, 30 days, uint64(block.timestamp + 90 days), "New");
        vm.prank(guardian);
        wallet.revokeMandate(id);
        vm.warp(block.timestamp + MANDATE_DELAY);
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.MandateNotApproved.selector, id));
        _pay(id, 1 * USD);
    }

    function test_OwnerCannotRemoveGuardian() public {
        vm.expectRevert(PolicyWallet.NotGuardian.selector);
        vm.prank(owner);
        wallet.transferGuardian(owner);

        vm.prank(guardian);
        wallet.transferGuardian(attacker);
        assertEq(wallet.guardian(), attacker);
    }

    // ---------------- mandates ----------------

    function test_AgentProposesOwnerApprovesThenDelay() public {
        vm.prank(agent);
        uint256 id =
            wallet.proposeMandate(landlord, 0, 200 * USD, 30 days, uint64(block.timestamp + 90 days), "Deposit");
        assertFalse(wallet.isMandateActive(id));

        vm.prank(owner);
        wallet.approveMandate(id);
        assertFalse(wallet.isMandateActive(id));

        vm.warp(block.timestamp + MANDATE_DELAY);
        assertTrue(wallet.isMandateActive(id));
        _pay(id, 200 * USD);
        assertEq(token.balanceOf(landlord), 200 * USD);
    }

    function test_RevertWhen_ApprovingMandateTwice() public {
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.MandateNotProposed.selector, tuition));
        vm.prank(owner);
        wallet.approveMandate(tuition);
    }

    function test_RevertWhen_MandateParamsInvalid() public {
        uint64 exp = uint64(block.timestamp + 90 days);
        vm.startPrank(owner);
        vm.expectRevert(PolicyWallet.InvalidPayee.selector);
        wallet.createMandate(address(0), 0, 1 * USD, 30 days, exp, "x");
        vm.expectRevert(PolicyWallet.InvalidPayee.selector);
        wallet.createMandate(address(wallet), 0, 1 * USD, 30 days, exp, "x");
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.UnknownBucket.selector, 9));
        wallet.createMandate(uni, 9, 1 * USD, 30 days, exp, "x");
        vm.expectRevert(PolicyWallet.ZeroAmount.selector);
        wallet.createMandate(uni, 0, 0, 30 days, exp, "x");
        vm.expectRevert(PolicyWallet.InvalidPeriod.selector);
        wallet.createMandate(uni, 0, 1 * USD, 1 hours, exp, "x");
        vm.expectRevert(PolicyWallet.InvalidExpiry.selector);
        wallet.createMandate(uni, 0, 1 * USD, 30 days, uint64(block.timestamp + MANDATE_DELAY), "x");
        vm.stopPrank();
    }

    // ---------------- buckets ----------------

    function test_AgentAllocatesIncomingFunds() public {
        token.mint(address(wallet), 1_000 * USD);
        assertEq(wallet.unallocated(), 3_400 * USD);

        vm.startPrank(agent);
        wallet.moveFunds(0, tuitionBucket, 400 * USD);
        wallet.moveFunds(0, livingBucket, 600 * USD);
        wallet.moveFunds(livingBucket, rentBucket, 100 * USD);
        vm.stopPrank();

        assertEq(wallet.bucketBalance(tuitionBucket), 6_400 * USD);
        assertEq(wallet.bucketBalance(livingBucket), 500 * USD);
        assertEq(wallet.bucketBalance(rentBucket), 1_700 * USD);
        assertEq(wallet.unallocated(), 2_400 * USD);
        assertEq(wallet.totalAllocated(), 8_600 * USD);
    }

    function test_RevertWhen_AgentTakesFromLockedBucket() public {
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.BucketLocked.selector, tuitionBucket));
        vm.prank(agent);
        wallet.moveFunds(tuitionBucket, livingBucket, 1 * USD);

        vm.prank(owner);
        wallet.moveFunds(tuitionBucket, livingBucket, 1 * USD);
        assertEq(wallet.bucketBalance(livingBucket), 1 * USD);
    }

    function test_RevertWhen_MoveIsInvalid() public {
        vm.startPrank(agent);
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.InsufficientBucket.selector, 0, 2_401 * USD, 2_400 * USD));
        wallet.moveFunds(0, livingBucket, 2_401 * USD);
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.UnknownBucket.selector, 9));
        wallet.moveFunds(0, 9, 1 * USD);
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.UnknownBucket.selector, 9));
        wallet.moveFunds(9, 0, 1 * USD);
        vm.expectRevert(PolicyWallet.SameBucket.selector);
        wallet.moveFunds(livingBucket, livingBucket, 1 * USD);
        vm.expectRevert(PolicyWallet.ZeroAmount.selector);
        wallet.moveFunds(0, livingBucket, 0);
        vm.stopPrank();
    }

    // ---------------- limits ----------------

    function test_TighteningLimitsIsInstant() public {
        vm.prank(owner);
        wallet.proposeLimits(100 * USD, 200 * USD);
        assertEq(wallet.perTxCap(), 100 * USD);
        assertEq(wallet.dailyCap(), 200 * USD);
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.OverPerTxCap.selector, 101 * USD, 100 * USD));
        _pay(tuition, 101 * USD);
    }

    function test_LooseningLimitsWaitsForDelay() public {
        vm.startPrank(owner);
        wallet.proposeLimits(PER_TX, 9_000 * USD);
        assertEq(wallet.dailyCap(), DAILY);

        uint64 eta = uint64(block.timestamp) + LOOSEN_DELAY;
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.LimitsNotReady.selector, eta));
        wallet.applyLimits();

        vm.warp(eta);
        wallet.applyLimits();
        assertEq(wallet.dailyCap(), 9_000 * USD);
        vm.expectRevert(PolicyWallet.NoPendingLimits.selector);
        wallet.applyLimits();
        vm.stopPrank();
    }

    function test_GuardianVetoesLooserLimits() public {
        vm.prank(owner);
        wallet.proposeLimits(50_000 * USD, 50_000 * USD);
        vm.prank(guardian);
        wallet.cancelLimits();

        vm.warp(block.timestamp + LOOSEN_DELAY);
        vm.expectRevert(PolicyWallet.NoPendingLimits.selector);
        vm.prank(owner);
        wallet.applyLimits();
        assertEq(wallet.perTxCap(), PER_TX);
    }

    // ---------------- escalation ----------------

    function test_OwnerApprovesPaymentAboveCap() public {
        vm.prank(agent);
        uint256 id = wallet.requestPayment(tuition, 4_500 * USD, REF);
        assertEq(token.balanceOf(uni), 0);

        vm.expectRevert(PolicyWallet.NotOwner.selector);
        vm.prank(agent);
        wallet.approveRequest(id);

        vm.prank(owner);
        wallet.approveRequest(id);
        assertEq(token.balanceOf(uni), 4_500 * USD);
        assertEq(wallet.bucketBalance(tuitionBucket), 1_500 * USD);
        assertEq(uint8(wallet.getRequest(id).status), uint8(PolicyWallet.RequestStatus.Approved));

        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.RequestNotPending.selector, id));
        vm.prank(owner);
        wallet.approveRequest(id);
    }

    function test_GuardianRejectsRequest() public {
        vm.prank(agent);
        uint256 id = wallet.requestPayment(tuition, 4_500 * USD, REF);
        vm.prank(guardian);
        wallet.rejectRequest(id);
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.RequestNotPending.selector, id));
        vm.prank(owner);
        wallet.approveRequest(id);
    }

    function test_RevertWhen_RequestTargetsUnapprovedMandate() public {
        vm.startPrank(agent);
        uint256 id = wallet.proposeMandate(attacker, 0, 1 * USD, 1 days, uint64(block.timestamp + 30 days), "x");
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.MandateNotApproved.selector, id));
        wallet.requestPayment(id, 1 * USD, REF);
        vm.stopPrank();
    }

    function test_RevertWhen_ApprovedRequestMandateWasRevoked() public {
        vm.prank(agent);
        uint256 id = wallet.requestPayment(tuition, 4_500 * USD, REF);
        vm.prank(guardian);
        wallet.revokeMandate(tuition);
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.MandateNotApproved.selector, tuition));
        vm.prank(owner);
        wallet.approveRequest(id);
    }

    // ---------------- owner exit ----------------

    function test_OwnerWithdrawsOnlyToSelfEvenWhenPaused() public {
        vm.prank(guardian);
        wallet.pause();
        vm.prank(owner);
        wallet.withdraw(0, 400 * USD);
        assertEq(token.balanceOf(owner), 400 * USD);
        assertEq(wallet.unallocated(), 2_000 * USD);
    }

    // ---------------- exposure ----------------

    function test_AgentExposure() public {
        assertEq(wallet.agentExposure(), DAILY);
        _pay(tuition, 1_000 * USD);
        assertEq(wallet.agentExposure(), DAILY - 1_000 * USD);

        vm.prank(guardian);
        wallet.pause();
        assertEq(wallet.agentExposure(), 0);
        vm.prank(owner);
        wallet.unpause();

        vm.prank(owner);
        wallet.withdraw(tuitionBucket, 5_000 * USD);
        vm.prank(owner);
        wallet.withdraw(0, 2_400 * USD);
        assertEq(wallet.agentExposure(), 1_600 * USD); // capped by what is left in the wallet

        vm.prank(guardian);
        wallet.revokeAgent();
        assertEq(wallet.agentExposure(), 0);
    }

    // ---------------- fuzz ----------------

    function testFuzz_SinglePaymentRespectsEveryCap(uint256 amount) public {
        amount = bound(amount, 1, 50_000 * USD);
        uint256 exposure = wallet.agentExposure();
        vm.prank(agent);
        try wallet.pay(tuition, amount, REF) {
            assertLe(amount, PER_TX);
            assertLe(amount, exposure);
            assertEq(token.balanceOf(uni), amount);
        } catch {
            assertEq(token.balanceOf(uni), 0);
        }
    }

    function testFuzz_NobodyElseCanPay(address caller, uint256 amount) public {
        vm.assume(caller != agent);
        vm.expectRevert(PolicyWallet.NotAgent.selector);
        vm.prank(caller);
        wallet.pay(tuition, amount, REF);
    }
}
