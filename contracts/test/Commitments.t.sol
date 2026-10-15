// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

import {Mandate} from "../src/Mandate.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {AssetRule, Commitment} from "../src/Types.sol";
import {VaultFixture} from "./utils/VaultFixture.sol";

/// Commitments: money with a job already (rent, bills, money sent home). It
/// stays out of the portfolio, the agent cannot trade it, and it leaves only
/// as an authorised payment or to the owner.
contract CommitmentsTest is VaultFixture {
    event CommitmentPaid(uint256 indexed id, address indexed payee, uint256 amount, uint64 due, bytes32 ref, address indexed by);
    event CommitmentProposed(uint256 indexed id, Commitment commitment, uint64 eta);
    event ReleaseProposed(uint256 indexed id, uint256 amount, uint64 eta);

    address landlord = makeAddr("landlord");
    address parents = makeAddr("parents");
    uint96 constant RENT = 1_000_000_000; // 1,000 tUSD
    uint32 constant MONTH = 30 days;
    uint32 constant WINDOW = 3 days;

    function _rent(uint64 due) internal view returns (Commitment memory) {
        return Commitment({payee: landlord, maxAmount: RENT, period: MONTH, window: WINDOW, nextDue: due, active: true});
    }

    function _reserveOnly() internal pure returns (Commitment memory) {
        return Commitment({payee: address(0), maxAmount: 0, period: 0, window: 0, nextDue: 0, active: true});
    }

    /// Adds rent as commitment 1, waits out the delay and sets 2,000 tUSD aside for it.
    function _rentReady(uint64 due) internal {
        vm.prank(owner);
        mandate.proposeCommitment(1, _rent(due));
        skip(LOOSEN_DELAY);
        _refreshPrices();
        vm.startPrank(owner);
        mandate.applyCommitment(1);
        vault.reserve(1, 2 * RENT);
        vm.stopPrank();
    }

    // ---------------- adding commitments ----------------

    function test_ReserveOnlyCommitmentAppliesAtOnce() public {
        vm.prank(owner);
        mandate.proposeCommitment(1, _reserveOnly());
        assertTrue(mandate.getCommitment(1).active);
        assertEq(mandate.pendingEta(mandate.commitmentKey(1)), 0);
        assertEq(mandate.commitmentCount(), 1);
    }

    function test_NewPayeeWaitsAndTheGuardianCanCancel() public {
        vm.expectEmit(true, true, true, true);
        emit CommitmentProposed(1, _rent(uint64(START + 10 days)), uint64(START + LOOSEN_DELAY));
        vm.prank(owner);
        mandate.proposeCommitment(1, _rent(uint64(START + 10 days)));
        assertFalse(mandate.getCommitment(1).active);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Mandate.ChangeNotReady.selector, uint64(START + LOOSEN_DELAY)));
        mandate.applyCommitment(1);

        bytes32 key = mandate.commitmentKey(1);
        vm.prank(guardian);
        mandate.cancelChange(key);
        skip(LOOSEN_DELAY);
        vm.prank(owner);
        vm.expectRevert(Mandate.NoPendingChange.selector);
        mandate.applyCommitment(1);
    }

    function test_NewPayeeAppliesAfterTheWait() public {
        _rentReady(uint64(START + 10 days));
        assertEq(mandate.getCommitment(1).payee, landlord);
        assertEq(vault.reserved(1), 2 * RENT);
    }

    function test_BeforeSigningCommitmentsApplyAtOnce() public {
        // an owner's second vault starts unsigned
        vm.prank(owner);
        (Mandate m,) = factory.createVault(guardian, LOOSEN_DELAY);
        vm.prank(owner);
        m.proposeCommitment(1, _rent(uint64(START + 10 days)));
        assertTrue(m.getCommitment(1).active);
    }

    function test_LoweringOrRemovingAppliesAtOnce_RaisingWaits() public {
        _rentReady(uint64(START + 10 days));
        Commitment memory c = _rent(uint64(START + 10 days));

        c.maxAmount = RENT / 2;
        vm.prank(owner);
        mandate.proposeCommitment(1, c);
        assertEq(mandate.getCommitment(1).maxAmount, RENT / 2);

        c.maxAmount = RENT;
        vm.prank(owner);
        mandate.proposeCommitment(1, c);
        assertEq(mandate.getCommitment(1).maxAmount, RENT / 2, "a raise waits");

        c.maxAmount = RENT / 2;
        c.nextDue = uint64(START + 5 days);
        vm.prank(owner);
        mandate.proposeCommitment(1, c);
        assertEq(mandate.getCommitment(1).nextDue, START + 10 days, "an earlier due date waits");

        c.nextDue = uint64(START + 10 days);
        c.payee = parents;
        vm.prank(owner);
        mandate.proposeCommitment(1, c);
        assertEq(mandate.getCommitment(1).payee, landlord, "a new payee waits");

        c.active = false;
        vm.prank(owner);
        mandate.proposeCommitment(1, c);
        assertFalse(mandate.getCommitment(1).active, "removing applies at once");
        assertEq(mandate.pendingEta(mandate.commitmentKey(1)), 0, "and drops the waiting change");
    }

    function test_PayeeCannotBeTheAgentTheOwnerOrTheVault() public {
        address[3] memory bad = [agent, owner, address(vault)];
        for (uint256 i = 0; i < bad.length; i++) {
            Commitment memory c = _rent(uint64(START + 10 days));
            c.payee = bad[i];
            vm.prank(owner);
            vm.expectRevert(Mandate.InvalidAddress.selector);
            mandate.proposeCommitment(1, c);
        }
    }

    function test_WindowMustFitThePeriod() public {
        Commitment memory c = _rent(uint64(START + 10 days));
        c.window = MONTH + 1;
        vm.prank(owner);
        vm.expectRevert(Mandate.InvalidCommitment.selector);
        mandate.proposeCommitment(1, c);
    }

    function test_OnlyTheOwnerChangesCommitments() public {
        vm.prank(agent);
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.proposeCommitment(1, _reserveOnly());
        vm.prank(guardian);
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.proposeCommitment(1, _reserveOnly());
    }

    function test_AtMostEightCommitments() public {
        vm.startPrank(owner);
        for (uint256 i = 1; i <= 8; i++) mandate.proposeCommitment(i, _reserveOnly());
        vm.expectRevert(Mandate.TooManyCommitments.selector);
        mandate.proposeCommitment(9, _reserveOnly());
        vm.expectRevert(Mandate.InvalidCommitment.selector);
        mandate.proposeCommitment(11, _reserveOnly());
        vm.stopPrank();
    }

    // ---------------- reserves stay out of the portfolio ----------------

    function test_ReservedMoneyLeavesThePortfolioWithoutLookingLikeALoss() public {
        vm.startPrank(owner);
        mandate.proposeCommitment(1, _reserveOnly());
        vault.reserve(1, 4_000 * USD);
        vm.stopPrank();

        assertEq(vault.reservedTotal(), 4_000 * USD);
        assertEq(vault.holdings(address(usd)), FUNDS);
        assertEq(vault.portfolioValue(), 6_000 * USD);
        assertEq(vault.drawdownBps(), 0);
        assertFalse(vault.inProtectMode());
    }

    function test_AgentCannotTradeReservedMoney() public {
        vm.startPrank(owner);
        mandate.proposeCommitment(1, _reserveOnly());
        vault.reserve(1, 9_500 * USD);
        vm.stopPrank();
        // 500 free, and the trade limit is 11% of the 500 tUSD portfolio
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsTradeLimit.selector, 400 * USD, 55 * USD));
        vault.buy(address(idx), 400 * USD, REF);
    }

    function test_EvenAnOwnerApprovedBuyCannotSpendReservedMoney() public {
        vm.startPrank(owner);
        mandate.proposeCommitment(1, _reserveOnly());
        vault.reserve(1, 9_000 * USD);
        vm.stopPrank();
        // the signature lifts the size limits, not the reserve
        (PolicyVault.TradeApproval memory a, bytes memory sig) = _approval(true, bond, 1_500 * USD, 1, 1 hours, OWNER_KEY);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.InsufficientBalance.selector, address(usd), 1_500 * USD, 1_000 * USD));
        vault.tradeWithApproval(a, sig, REF);
    }

    function test_CanSetMoneyAsideForANewPayeeStillWaiting() public {
        vm.startPrank(owner);
        mandate.proposeCommitment(1, _rent(uint64(START + 10 days)));
        vault.reserve(1, RENT);
        vm.stopPrank();
        assertFalse(mandate.getCommitment(1).active);
        assertEq(vault.reserved(1), RENT);
        // and nothing can be paid from it until the payee is approved
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.CommitmentNotPayable.selector, 1));
        vault.payCommitment(1, RENT, REF);
    }

    function test_CannotReserveMoreThanFreeCash() public {
        vm.startPrank(owner);
        mandate.proposeCommitment(1, _reserveOnly());
        vault.reserve(1, 6_000 * USD);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.InsufficientBalance.selector, address(usd), 4_001 * USD, 4_000 * USD));
        vault.reserve(1, 4_001 * USD);
        vm.stopPrank();
    }

    function test_CannotReserveForAMissingCommitment() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.CommitmentNotPayable.selector, 3));
        vault.reserve(3, USD);
    }

    function test_OnlyTheOwnerReservesOrReleases() public {
        vm.prank(owner);
        mandate.proposeCommitment(1, _reserveOnly());
        vm.prank(agent);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.reserve(1, USD);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.proposeRelease(1, USD);
    }

    // ---------------- moving money back into investing waits ----------------

    function test_ReleaseWaitsThenRejoinsThePortfolio() public {
        vm.startPrank(owner);
        mandate.proposeCommitment(1, _reserveOnly());
        vault.reserve(1, 4_000 * USD);
        vm.expectEmit(true, true, true, true);
        emit ReleaseProposed(1, 3_000 * USD, uint64(START + LOOSEN_DELAY));
        vault.proposeRelease(1, 3_000 * USD);
        vm.expectRevert(abi.encodeWithSelector(Mandate.ChangeNotReady.selector, uint64(START + LOOSEN_DELAY)));
        vault.applyRelease(1);
        vm.stopPrank();

        skip(LOOSEN_DELAY);
        _refreshPrices();
        vm.prank(owner);
        vault.applyRelease(1);
        assertEq(vault.reserved(1), 1_000 * USD);
        assertEq(vault.portfolioValue(), 9_000 * USD);
        assertEq(vault.drawdownBps(), 0);
    }

    function test_GuardianCanCancelARelease() public {
        vm.startPrank(owner);
        mandate.proposeCommitment(1, _reserveOnly());
        vault.reserve(1, 4_000 * USD);
        vault.proposeRelease(1, 4_000 * USD);
        vm.stopPrank();

        bytes32 key = mandate.releaseKey(1);
        vm.prank(guardian);
        mandate.cancelChange(key);
        skip(LOOSEN_DELAY);
        vm.prank(owner);
        vm.expectRevert(Mandate.NoPendingChange.selector);
        vault.applyRelease(1);
        assertEq(vault.reserved(1), 4_000 * USD);
    }

    function test_OnlyTheVaultQueuesOrTakesReleases() public {
        vm.prank(owner);
        vm.expectRevert(Mandate.NotVault.selector);
        mandate.queueRelease(1);
        vm.prank(owner);
        vm.expectRevert(Mandate.NotVault.selector);
        mandate.takeRelease(1);
        vm.prank(agent);
        vm.expectRevert(Mandate.NotVault.selector);
        mandate.markPaid(1);
    }

    function test_WithdrawingCanTakeReservedMoneyAtOnce() public {
        vm.startPrank(owner);
        mandate.proposeCommitment(1, _reserveOnly());
        vault.reserve(1, 4_000 * USD);
        vault.withdraw(address(usd), 7_000 * USD);
        vm.stopPrank();
        assertEq(vault.reserved(1), 3_000 * USD);
        assertEq(vault.reservedTotal(), 3_000 * USD);
        assertEq(vault.portfolioValue(), 0);
        assertEq(usd.balanceOf(owner), 7_000 * USD);
    }

    // ---------------- paying ----------------

    function test_AgentPaysInsideTheWindow() public {
        uint64 due = uint64(START + 10 days);
        _rentReady(due);
        vm.warp(due - WINDOW);
        uint256 valueBefore = _portfolioValueFresh();

        vm.expectEmit(true, true, true, true);
        emit CommitmentPaid(1, landlord, RENT, due, REF, agent);
        vm.prank(agent);
        vault.payCommitment(1, RENT, REF);

        assertEq(usd.balanceOf(landlord), RENT);
        assertEq(vault.reserved(1), RENT);
        assertEq(vault.holdings(address(usd)), FUNDS - RENT);
        assertEq(mandate.getCommitment(1).nextDue, due + MONTH);
        assertEq(vault.portfolioValue(), valueBefore, "paying from a reserve does not touch the portfolio");
    }

    function test_AgentCannotPayEarly() public {
        uint64 due = uint64(START + 10 days);
        _rentReady(due);
        vm.warp(due - WINDOW - 1);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.CommitmentNotDue.selector, 1, due));
        vault.payCommitment(1, RENT, REF);
    }

    function test_SameDueDateCannotBePaidTwice() public {
        uint64 due = uint64(START + 10 days);
        _rentReady(due);
        vm.warp(due);
        vm.startPrank(agent);
        vault.payCommitment(1, RENT, REF);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.CommitmentNotDue.selector, 1, due + MONTH));
        vault.payCommitment(1, RENT, REF);
        vm.stopPrank();
    }

    function test_AgentCannotPayMoreThanTheCommitmentOrTheReserve() public {
        uint64 due = uint64(START + 10 days);
        _rentReady(due);
        vm.warp(due);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsCommitmentAmount.selector, RENT + 1, RENT));
        vault.payCommitment(1, RENT + 1, REF);

        vm.prank(owner);
        vault.withdraw(address(usd), FUNDS - RENT / 2); // leaves half a rent, all of it reserved
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsReserve.selector, RENT, RENT / 2));
        vault.payCommitment(1, RENT, REF);
    }

    function test_OwnerPaysEarlyAndTheScheduleMovesOn() public {
        uint64 due = uint64(START + 10 days);
        _rentReady(due);
        vm.prank(owner);
        vault.payCommitment(1, RENT, REF);
        assertEq(mandate.getCommitment(1).nextDue, due + MONTH);

        // the scheduler wakes up on the due date and finds nothing to pay
        vm.warp(due);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.CommitmentNotDue.selector, 1, due + MONTH));
        vault.payCommitment(1, RENT, REF);
    }

    function test_SinglePaymentClosesTheCommitment() public {
        Commitment memory fee = Commitment({payee: parents, maxAmount: RENT, period: 0, window: WINDOW, nextDue: uint64(START + 5 days), active: true});
        vm.prank(owner);
        mandate.proposeCommitment(1, fee);
        skip(LOOSEN_DELAY);
        vm.startPrank(owner);
        mandate.applyCommitment(1);
        vault.reserve(1, 2 * RENT);
        vm.stopPrank();

        vm.warp(START + 5 days);
        vm.prank(agent);
        vault.payCommitment(1, RENT, REF);
        assertFalse(mandate.getCommitment(1).active);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.CommitmentNotPayable.selector, 1));
        vault.payCommitment(1, RENT, REF);
    }

    function test_ReserveOnlyCommitmentCannotBePaidOut() public {
        vm.startPrank(owner);
        mandate.proposeCommitment(1, _reserveOnly());
        vault.reserve(1, RENT);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.CommitmentNotPayable.selector, 1));
        vault.payCommitment(1, RENT, REF);
        vm.stopPrank();
    }

    function test_StrangersAndAPausedAgentCannotPay() public {
        uint64 due = uint64(START + 10 days);
        _rentReady(due);
        vm.warp(due);
        vm.prank(attacker);
        vm.expectRevert(Mandate.NotAgent.selector);
        vault.payCommitment(1, RENT, REF);

        vm.prank(guardian);
        mandate.pause();
        vm.prank(agent);
        vm.expectRevert(Mandate.AgentPaused.selector);
        vault.payCommitment(1, RENT, REF);
        // the owner still can
        vm.prank(owner);
        vault.payCommitment(1, RENT, REF);
        assertEq(usd.balanceOf(landlord), RENT);
    }

    function test_ARemovedCommitmentCannotBePaid() public {
        uint64 due = uint64(START + 10 days);
        _rentReady(due);
        Commitment memory c = _rent(due);
        c.active = false;
        vm.prank(owner);
        mandate.proposeCommitment(1, c);
        vm.warp(due);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.CommitmentNotPayable.selector, 1));
        vault.payCommitment(1, RENT, REF);
    }

    function testFuzz_AgentNeverPaysOutsideTheTerms(uint256 amount, uint256 when) public {
        uint64 due = uint64(START + 10 days);
        _rentReady(due);
        when = bound(when, block.timestamp, due + 2 * MONTH);
        amount = bound(amount, 1, 3 * RENT);
        vm.warp(when);
        vm.prank(agent);
        try vault.payCommitment(1, amount, REF) {
            assertLe(amount, RENT);
            assertGe(when + WINDOW, due);
            assertEq(usd.balanceOf(landlord), amount);
        } catch {
            assertEq(usd.balanceOf(landlord), 0);
        }
    }

    function _portfolioValueFresh() internal returns (uint256) {
        _refreshPrices();
        return vault.portfolioValue();
    }
}
