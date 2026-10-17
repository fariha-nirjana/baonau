// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

import {Mandate} from "../src/Mandate.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {AssetRule, Commitment, Policy} from "../src/Types.sol";
import {VaultFixture} from "./utils/VaultFixture.sol";

/// The input checks, each hit head-on with the exact error it should give.
/// These were the checks a mutation run could switch off without any other
/// test noticing.
contract InputChecksTest is VaultFixture {
    address landlord = makeAddr("landlord");

    function _rent() internal view returns (Commitment memory) {
        return Commitment({payee: landlord, maxAmount: 1_000 * 1e6, period: 30 days, window: 3 days, nextDue: uint64(START + 10 days), active: true});
    }

    // ---------------- vault: amounts must be more than zero ----------------

    function test_RevertWhen_RebalanceHasNoOrders() public {
        PolicyVault.Order[] memory none = new PolicyVault.Order[](0);
        vm.prank(agent);
        vm.expectRevert(PolicyVault.ZeroAmount.selector);
        vault.rebalance(none, REF);
    }

    function test_RevertWhen_DepositIsZero() public {
        vm.prank(owner);
        vm.expectRevert(PolicyVault.ZeroAmount.selector);
        vault.deposit(address(usd), 0);
    }

    function test_RevertWhen_WithdrawalIsZero() public {
        vm.prank(owner);
        vm.expectRevert(PolicyVault.ZeroAmount.selector);
        vault.withdraw(address(usd), 0);
    }

    function test_RevertWhen_ReserveIsZero() public {
        vm.prank(owner);
        vm.expectRevert(PolicyVault.ZeroAmount.selector);
        vault.reserve(1, 0);
    }

    function test_RevertWhen_ReleaseIsZero() public {
        vm.prank(owner);
        vm.expectRevert(PolicyVault.ZeroAmount.selector);
        vault.proposeRelease(1, 0);
    }

    function test_RevertWhen_ReleaseIsMoreThanReserved() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsReserve.selector, 5, 0));
        vault.proposeRelease(1, 5);
    }

    function test_RevertWhen_CommitmentPaymentIsZero() public {
        vm.prank(owner);
        mandate.proposeCommitment(1, _rent());
        skip(LOOSEN_DELAY);
        _refreshPrices();
        vm.startPrank(owner);
        mandate.applyCommitment(1);
        vault.reserve(1, 1_000 * 1e6);
        vm.expectRevert(PolicyVault.ZeroAmount.selector);
        vault.payCommitment(1, 0, REF);
        vm.stopPrank();
    }

    function test_RevertWhen_NothingToSweep() public {
        vm.prank(owner);
        vm.expectRevert(PolicyVault.ZeroAmount.selector);
        vault.sweep(address(usd));
    }

    // ---------------- mandate: setup and rules ----------------

    function test_RevertWhen_GuardianIsTheOwner() public {
        vm.prank(owner);
        vm.expectRevert(Mandate.InvalidAddress.selector);
        factory.createVault(owner, LOOSEN_DELAY);
    }

    function test_RevertWhen_AssetsAndRulesDifferInLength() public {
        vm.prank(stranger);
        (Mandate fresh,) = factory.createVault(guardian, LOOSEN_DELAY);
        (address[] memory assets,) = _assetRules();
        AssetRule[] memory rules = new AssetRule[](1);
        rules[0] = AssetRule(true, false, 5000, 0);
        vm.prank(stranger);
        vm.expectRevert(Mandate.LengthMismatch.selector);
        fresh.signMandate(_policy(), assets, rules, agent, AGENT_EXPIRY);
    }

    function test_RevertWhen_CancellingWithNothingWaiting() public {
        vm.prank(owner);
        vm.expectRevert(Mandate.NoPendingChange.selector);
        mandate.cancelChange(keccak256("nothing waiting"));
    }

    function test_RevertWhen_AssetRuleHasNoAddress() public {
        vm.prank(owner);
        vm.expectRevert(Mandate.ZeroAddress.selector);
        mandate.proposeAssetRule(address(0), AssetRule(true, false, 1000, 0));
    }

    function test_RevertWhen_AssetCapIsAboveEverything() public {
        vm.prank(owner);
        vm.expectRevert(Mandate.InvalidPolicy.selector);
        mandate.proposeAssetRule(address(idx), AssetRule(true, false, 10_001, 0));
    }

    function test_RevertWhen_CommitmentHasNoAmount() public {
        Commitment memory c = _rent();
        c.maxAmount = 0;
        vm.prank(owner);
        vm.expectRevert(Mandate.InvalidCommitment.selector);
        mandate.proposeCommitment(1, c);
    }
}
