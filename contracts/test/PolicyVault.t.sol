// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PolicyVault} from "../src/PolicyVault.sol";
import {MockAsset} from "../src/mocks/MockAsset.sol";
import {PriceOracle} from "../src/mocks/PriceOracle.sol";
import {SkimmingExchange} from "./utils/SkimmingExchange.sol";
import {VaultFixture} from "./utils/VaultFixture.sol";

contract PolicyVaultTest is VaultFixture {
    function _rule(bool allowed, uint16 capBps, uint256 stopPrice) internal pure returns (PolicyVault.AssetRule memory) {
        return PolicyVault.AssetRule(allowed, capBps, stopPrice);
    }

    /// Three 10% drops take the index from 100 to 72.9, a 10.84% loss on the day for the portfolio.
    function _crashIndex() internal {
        _setPrice(idx, 90 * PRICE);
        _setPrice(idx, 81 * PRICE);
        _setPrice(idx, 729 * PRICE / 10);
    }

    function _setStop(uint256 stopPrice) internal {
        vm.prank(owner);
        vault.proposeAssetRule(address(idx), _rule(true, 5000, stopPrice));
    }

    // ---------------- agent: allowed ----------------

    function test_AgentBuysAllowlistedAsset() public {
        vm.expectEmit(true, true, true, true);
        emit PolicyVault.Trade(address(idx), true, 1_000 * USD, 9.97e18, 100 * PRICE, REF, agent);
        uint256 out = _buy(idx, 1_000 * USD);

        assertEq(out, 9.97e18);
        assertEq(vault.holdings(address(idx)), 9.97e18);
        assertEq(vault.holdings(address(usd)), 9_000 * USD);
        assertEq(idx.balanceOf(address(vault)), 9.97e18);
        assertEq(usd.balanceOf(address(vault)), 9_000 * USD);
        assertEq(vault.portfolioValue(), 9_997 * USD);
        assertEq(vault.dailyVolumeRemaining(), 2_000 * USD);
        assertEq(vault.exposureBps(address(idx)), 997);
    }

    function test_AgentSellsBackIntoStable() public {
        _buy(idx, 1_000 * USD);
        uint256 out = _sell(idx, 9.97e18);

        assertEq(out, 994_009_000);
        assertEq(vault.holdings(address(idx)), 0);
        assertEq(vault.holdings(address(usd)), 9_000 * USD + 994_009_000);
        assertEq(vault.dailyVolumeRemaining(), MAX_DAILY - 1_000 * USD - 997 * USD);
    }

    function test_RebalanceRunsSeveralTradesInOneCall() public {
        _buy(idx, 1_000 * USD);
        PolicyVault.Order[] memory orders = new PolicyVault.Order[](3);
        orders[0] = PolicyVault.Order(address(idx), false, 4e18);
        orders[1] = PolicyVault.Order(address(bond), true, 600 * USD);
        orders[2] = PolicyVault.Order(address(gold), true, 250 * USD);
        vm.prank(agent);
        vault.rebalance(orders, REF);

        assertEq(vault.holdings(address(idx)), 5.97e18);
        assertEq(vault.holdings(address(bond)), 5.982e18);
        assertEq(vault.holdings(address(gold)), 0.997e18);
        assertEq(vault.dailyVolumeRemaining(), MAX_DAILY - (1_000 + 400 + 600 + 250) * USD);
    }

    function test_DailyVolumeResetsNextDay() public {
        _buy(idx, 1_000 * USD);
        _buy(bond, 1_000 * USD);
        _buy(bond, 1_000 * USD);
        assertEq(vault.dailyVolumeRemaining(), 0);

        skip(1 days);
        _refreshPrices();
        assertEq(vault.dailyVolumeRemaining(), MAX_DAILY);
        _buy(bond, 500 * USD);
        assertEq(vault.dailyVolumeRemaining(), MAX_DAILY - 500 * USD);
    }

    // ---------------- agent: blocked ----------------

    function test_RevertWhen_CallerIsNotAgent() public {
        vm.expectRevert(PolicyVault.NotAgent.selector);
        vm.prank(attacker);
        vault.buy(address(idx), 100 * USD, REF);

        vm.expectRevert(PolicyVault.NotAgent.selector);
        vm.prank(attacker);
        vault.sell(address(idx), 1, REF);
    }

    function test_RevertWhen_AgentKeyExpired() public {
        vm.warp(START + 60 days);
        vm.expectRevert(PolicyVault.AgentKeyExpired.selector);
        _buy(idx, 100 * USD);
    }

    function test_RevertWhen_AgentRevoked() public {
        vm.prank(guardian);
        vault.revokeAgent();
        vm.expectRevert(PolicyVault.NotAgent.selector);
        _buy(idx, 100 * USD);
    }

    function test_RevertWhen_Paused() public {
        vm.prank(guardian);
        vault.pause();
        vm.expectRevert(PolicyVault.WalletPaused.selector);
        _buy(idx, 100 * USD);
    }

    function test_RevertWhen_ZeroAmount() public {
        vm.expectRevert(PolicyVault.ZeroAmount.selector);
        _buy(idx, 0);
        vm.expectRevert(PolicyVault.ZeroAmount.selector);
        _sell(idx, 0);
    }

    function test_RevertWhen_SellIsWorthLessThanOneUnit() public {
        _buy(idx, 1_000 * USD);
        // at 100 per unit, anything under 1e10 wei of the index is worth less than a millionth of a dollar
        vm.expectRevert(PolicyVault.ZeroAmount.selector);
        _sell(idx, 1e10 - 1);
        _sell(idx, 1e10);
    }

    function test_RevertWhen_AssetNotAllowed() public {
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.AssetNotAllowed.selector, address(meme)));
        _buy(meme, 100 * USD);
        assertEq(meme.balanceOf(address(vault)), 0);
    }

    function test_RevertWhen_SellingUnknownAsset() public {
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.UnknownAsset.selector, address(meme)));
        _sell(meme, 1e18);
    }

    function test_RevertWhen_OverTradeLimit() public {
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsTradeLimit.selector, MAX_TRADE + 1, MAX_TRADE));
        _buy(idx, MAX_TRADE + 1);
    }

    function test_RevertWhen_SellOverTradeLimit() public {
        _buy(idx, 1_000 * USD);
        _buy(idx, 1_000 * USD);
        // 19.94 units at 100 is 1,994 tUSD, above the 1,000 limit
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsTradeLimit.selector, 1_994 * USD, MAX_TRADE));
        _sell(idx, 19.94e18);
    }

    function test_RevertWhen_OverDailyVolume() public {
        _buy(idx, 1_000 * USD);
        _buy(bond, 1_000 * USD);
        _buy(bond, 600 * USD);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsDailyVolume.selector, 500 * USD, 400 * USD));
        _buy(bond, 500 * USD);
    }

    function test_RevertWhen_OverExposureCap() public {
        // gold is capped at 20% of the portfolio
        _buy(gold, 1_000 * USD);
        _buy(gold, 1_000 * USD);
        assertEq(vault.exposureBps(address(gold)), 1995);
        // a third buy would make it 2,991 of 9,991
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsExposure.selector, address(gold), 2993, 2000));
        _buy(gold, 1_000 * USD);
    }

    function test_RevertWhen_NotEnoughCash() public {
        vm.prank(owner);
        vault.withdraw(address(usd), FUNDS - 500 * USD);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyVault.InsufficientBalance.selector, address(usd), 600 * USD, 500 * USD)
        );
        _buy(bond, 600 * USD);
    }

    function test_RevertWhen_SellingMoreThanHeld() public {
        _buy(idx, 1_000 * USD);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyVault.InsufficientBalance.selector, address(idx), 10e18, 9.97e18)
        );
        _sell(idx, 10e18);
    }

    function test_RevertWhen_PriceIsStale() public {
        skip(MAX_PRICE_AGE + 1);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.StalePrice.selector, address(idx), START));
        _buy(idx, 100 * USD);
    }

    function test_RevertWhen_HeldAssetPriceIsStale() public {
        _buy(idx, 1_000 * USD);
        skip(MAX_PRICE_AGE + 1);
        // bond is fresh again, but the portfolio cannot be valued while the index price is old
        vm.prank(updater);
        oracle.setPrice(address(bond), 100 * PRICE);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.StalePrice.selector, address(idx), START));
        _buy(bond, 100 * USD);
    }

    function test_RevertWhen_OneRebalanceLegBreaksARule() public {
        PolicyVault.Order[] memory orders = new PolicyVault.Order[](2);
        orders[0] = PolicyVault.Order(address(idx), true, 500 * USD);
        orders[1] = PolicyVault.Order(address(meme), true, 100 * USD);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.AssetNotAllowed.selector, address(meme)));
        vm.prank(agent);
        vault.rebalance(orders, REF);
        assertEq(vault.holdings(address(idx)), 0);
        assertEq(vault.holdings(address(usd)), FUNDS);
    }

    function test_RevertWhen_TooManyOrders() public {
        PolicyVault.Order[] memory orders = new PolicyVault.Order[](9);
        vm.expectRevert(PolicyVault.TooManyOrders.selector);
        vm.prank(agent);
        vault.rebalance(orders, REF);
    }

    function test_RevertWhen_AgentCallsOwnerFunctions() public {
        address[] memory none = new address[](0);
        PolicyVault.AssetRule[] memory noRules = new PolicyVault.AssetRule[](0);
        PolicyVault.Policy memory loose = _policy();
        loose.maxTradeUsd = type(uint256).max;

        vm.startPrank(agent);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.withdraw(address(usd), 1 * USD);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.deposit(address(usd), 1 * USD);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.sweep(address(usd));
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.initialize(loose, none, noRules);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.proposePolicy(loose);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.applyPolicy();
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.proposeAssetRule(address(meme), _rule(true, 10_000, 0));
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.applyAssetRule(address(meme));
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.approveRequest(1);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.setAgent(agent, uint64(block.timestamp + 90 days));
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.setGuardian(agent);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.unpause();
        vm.expectRevert(PolicyVault.NotOwnerOrGuardian.selector);
        vault.pause();
        vm.expectRevert(PolicyVault.NotOwnerOrGuardian.selector);
        vault.cancelPolicy();
        vm.expectRevert(PolicyVault.NotGuardian.selector);
        vault.transferGuardian(agent);
        vm.stopPrank();
    }

    // ---------------- execution quality ----------------

    function _vaultOn(SkimmingExchange venue) internal returns (PolicyVault v) {
        v = new PolicyVault(usd, oracle, venue, owner, guardian, LOOSEN_DELAY, MAX_PRICE_AGE);
        address[] memory assets = new address[](1);
        assets[0] = address(idx);
        PolicyVault.AssetRule[] memory rules = new PolicyVault.AssetRule[](1);
        rules[0] = _rule(true, 10_000, 0);

        // stock the venue and the owner with index units bought on the honest exchange
        usd.mint(address(this), 20_000 * USD);
        usd.approve(address(exchange), 20_000 * USD);
        exchange.buy(address(idx), 20_000 * USD, 0);
        idx.transfer(address(venue), 100e18);
        idx.transfer(owner, 50e18);

        usd.mint(owner, FUNDS);
        vm.startPrank(owner);
        v.initialize(_policy(), assets, rules);
        v.setAgent(agent, uint64(block.timestamp + 60 days));
        usd.approve(address(v), type(uint256).max);
        idx.approve(address(v), type(uint256).max);
        v.deposit(address(usd), FUNDS);
        v.deposit(address(idx), 50e18);
        vm.stopPrank();
    }

    function test_RevertWhen_VenueGivesTooLittleOnBuy() public {
        PolicyVault v = _vaultOn(new SkimmingExchange(usd, oracle, idx, 200));
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.SlippageTooHigh.selector, 9.8e18, 9.9e18));
        vm.prank(agent);
        v.buy(address(idx), 1_000 * USD, REF);
    }

    function test_RevertWhen_VenueGivesTooLittleOnSell() public {
        PolicyVault v = _vaultOn(new SkimmingExchange(usd, oracle, idx, 200));
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.SlippageTooHigh.selector, 980 * USD, 990 * USD));
        vm.prank(agent);
        v.sell(address(idx), 10e18, REF);
    }

    function test_VenueWithinSlippageIsAccepted() public {
        PolicyVault v = _vaultOn(new SkimmingExchange(usd, oracle, idx, 50));
        vm.prank(agent);
        v.buy(address(idx), 1_000 * USD, REF);
        assertEq(v.holdings(address(idx)), 50e18 + 9.95e18);
    }

    // ---------------- daily loss limit and protect mode ----------------

    function test_RevertWhen_DailyLossLimitReached() public {
        _holdIndex();
        _crashIndex();
        assertEq(vault.drawdownBps(), 1084);
        assertTrue(vault.inProtectMode());

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsDailyLoss.selector, 1084, DAILY_LOSS_BPS));
        _buy(bond, 100 * USD);
    }

    function test_SellingStillWorksInProtectMode() public {
        _holdIndex();
        _crashIndex();
        uint256 out = _sell(idx, 10e18);

        assertEq(out, 726_813_000);
        assertEq(vault.cooldownUntil(), block.timestamp + COOLDOWN);
    }

    function test_AnyoneCanStartProtectMode() public {
        _holdIndex();
        _crashIndex();
        assertEq(vault.cooldownUntil(), 0);

        vm.expectEmit(true, true, true, true);
        emit PolicyVault.ProtectModeEntered(1084, uint64(block.timestamp + COOLDOWN));
        vm.prank(stranger);
        vault.poke();
        assertEq(vault.cooldownUntil(), block.timestamp + COOLDOWN);
    }

    function test_PokeDoesNothingWithoutALoss() public {
        _holdIndex();
        vm.prank(stranger);
        vault.poke();
        assertEq(vault.cooldownUntil(), 0);
        assertFalse(vault.inProtectMode());
    }

    function test_CooldownOutlastsAPriceRecovery() public {
        _holdIndex();
        _crashIndex();
        vault.poke();
        uint64 until = vault.cooldownUntil();

        _setPrice(idx, 8_019_000_000);
        _setPrice(idx, 8_820_900_000);
        _setPrice(idx, 9_702_990_000);
        assertLt(vault.drawdownBps(), DAILY_LOSS_BPS);
        assertTrue(vault.inProtectMode());

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.CooldownActive.selector, until));
        _buy(bond, 100 * USD);
    }

    function test_BuyingResumesAfterCooldown() public {
        _holdIndex();
        _crashIndex();
        vault.poke();
        _setPrice(idx, 8_019_000_000);
        _setPrice(idx, 8_820_900_000);
        _setPrice(idx, 9_702_990_000);

        skip(COOLDOWN);
        _refreshPrices();
        assertFalse(vault.inProtectMode());
        _buy(bond, 100 * USD);
        assertGt(vault.holdings(address(bond)), 0);
    }

    /// Known limit: the loss is measured from each UTC day's first snapshot.
    function test_LossLimitIsMeasuredPerUtcDay() public {
        _holdIndex();
        _crashIndex();
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsDailyLoss.selector, 1084, DAILY_LOSS_BPS));
        _buy(bond, 100 * USD);

        skip(1 days);
        _refreshPrices();
        _buy(bond, 100 * USD);
        assertEq(vault.drawdownBps(), 0);
    }

    function test_WithdrawalIsNotALoss() public {
        _buy(idx, 1_000 * USD);
        vm.prank(owner);
        vault.withdraw(address(usd), 5_000 * USD);

        // still only the 3 tUSD fee, now measured against 5,000 instead of 10,000
        assertEq(vault.drawdownBps(), 6);
        assertFalse(vault.inProtectMode());
        _buy(bond, 100 * USD);
    }

    function test_DonatedTokensDoNotChangeRiskChecks() public {
        _holdIndex();
        _crashIndex();
        usd.mint(address(vault), 1_000_000 * USD);

        assertEq(vault.portfolioValue(), 8_907_252_000);
        assertEq(vault.drawdownBps(), 1084);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsDailyLoss.selector, 1084, DAILY_LOSS_BPS));
        _buy(bond, 100 * USD);

        vm.prank(owner);
        vault.sweep(address(usd));
        assertEq(usd.balanceOf(owner), 1_000_000 * USD);
        assertEq(usd.balanceOf(address(vault)), vault.holdings(address(usd)));
    }

    // ---------------- stop-loss ----------------

    function test_AnyoneCanTriggerStopLoss() public {
        _setStop(90 * PRICE);
        _holdIndex();
        _setPrice(idx, 90 * PRICE);
        uint256 volumeLeft = vault.dailyVolumeRemaining();

        vm.expectEmit(true, true, true, true);
        emit PolicyVault.StopLossTriggered(address(idx), 39.88e18, 3_578_432_400, 90 * PRICE, stranger);
        vm.prank(stranger);
        uint256 out = vault.triggerStopLoss(address(idx));

        assertEq(out, 3_578_432_400);
        assertEq(vault.holdings(address(idx)), 0);
        assertEq(vault.holdings(address(usd)), 6_000 * USD + 3_578_432_400);
        assertEq(usd.balanceOf(address(vault)), 6_000 * USD + 3_578_432_400);
        // the caller gets nothing
        assertEq(usd.balanceOf(stranger), 0);
        assertEq(idx.balanceOf(stranger), 0);
        // it starts the cooldown and does not use the agent's volume
        assertEq(vault.cooldownUntil(), block.timestamp + COOLDOWN);
        assertEq(vault.dailyVolumeRemaining(), volumeLeft);
    }

    function test_StopLossWorksWithoutAnAgent() public {
        _setStop(90 * PRICE);
        _holdIndex();
        vm.prank(owner);
        vault.revokeAgent();
        _setPrice(idx, 90 * PRICE);

        vm.prank(stranger);
        vault.triggerStopLoss(address(idx));
        assertEq(vault.holdings(address(idx)), 0);
    }

    function test_RevertWhen_StopPriceNotReached() public {
        _setStop(90 * PRICE);
        _holdIndex();
        _setPrice(idx, 95 * PRICE);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyVault.StopNotReached.selector, address(idx), 95 * PRICE, 90 * PRICE)
        );
        vm.prank(stranger);
        vault.triggerStopLoss(address(idx));
    }

    function test_RevertWhen_NoStopPriceSet() public {
        _holdIndex();
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.StopNotReached.selector, address(idx), 100 * PRICE, 0));
        vault.triggerStopLoss(address(idx));
    }

    function test_RevertWhen_StopLossHasNothingToSell() public {
        _setStop(90 * PRICE);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.NothingToSell.selector, address(idx)));
        vault.triggerStopLoss(address(idx));
    }

    function test_RevertWhen_StopLossPriceIsStale() public {
        _setStop(90 * PRICE);
        _holdIndex();
        _setPrice(idx, 90 * PRICE);
        uint256 updatedAt = block.timestamp;
        skip(MAX_PRICE_AGE + 1);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.StalePrice.selector, address(idx), updatedAt));
        vault.triggerStopLoss(address(idx));
    }

    function test_RevertWhen_StopLossWhilePaused() public {
        _setStop(90 * PRICE);
        _holdIndex();
        _setPrice(idx, 90 * PRICE);
        vm.prank(guardian);
        vault.pause();
        vm.expectRevert(PolicyVault.WalletPaused.selector);
        vault.triggerStopLoss(address(idx));
    }

    function test_RevertWhen_BuyingAtOrBelowStopPrice() public {
        _setStop(90 * PRICE);
        _holdIndex();
        _setPrice(idx, 90 * PRICE);
        vault.triggerStopLoss(address(idx));

        skip(COOLDOWN);
        _refreshPrices();
        vm.expectRevert(
            abi.encodeWithSelector(PolicyVault.BelowStopPrice.selector, address(idx), 90 * PRICE, 90 * PRICE)
        );
        _buy(idx, 100 * USD);
    }

    function test_RaisingStopPriceIsInstant_LoweringWaits() public {
        _setStop(90 * PRICE);
        assertEq(vault.getRule(address(idx)).stopPrice, 90 * PRICE);

        _setStop(95 * PRICE);
        assertEq(vault.getRule(address(idx)).stopPrice, 95 * PRICE);

        _setStop(50 * PRICE);
        assertEq(vault.getRule(address(idx)).stopPrice, 95 * PRICE);
        assertEq(vault.getPendingRule(address(idx)).eta, block.timestamp + LOOSEN_DELAY);
    }

    // ---------------- policy changes: stricter is instant, looser waits ----------------

    function test_TighteningPolicyIsInstant() public {
        PolicyVault.Policy memory p = _policy();
        p.maxTradeUsd = 200 * USD;
        p.dailyLossBps = 300;
        p.cooldown = 1 days;
        vm.prank(owner);
        vault.proposePolicy(p);

        assertEq(vault.getPolicy().maxTradeUsd, 200 * USD);
        assertEq(vault.getPolicy().dailyLossBps, 300);
        assertEq(vault.getPolicy().cooldown, 1 days);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsTradeLimit.selector, 201 * USD, 200 * USD));
        _buy(idx, 201 * USD);
    }

    function test_LooseningPolicyWaitsForTheDelay() public {
        PolicyVault.Policy memory p = _policy();
        p.dailyLossBps = 5000;
        vm.startPrank(owner);
        vault.proposePolicy(p);
        assertEq(vault.getPolicy().dailyLossBps, DAILY_LOSS_BPS);
        uint64 eta = uint64(block.timestamp) + LOOSEN_DELAY;
        assertEq(vault.getPendingPolicy().eta, eta);

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ChangeNotReady.selector, eta));
        vault.applyPolicy();

        vm.warp(eta);
        vault.applyPolicy();
        vm.stopPrank();
        assertEq(vault.getPolicy().dailyLossBps, 5000);
        assertEq(vault.getPendingPolicy().eta, 0);
    }

    function test_EveryLooseningDirectionWaits() public {
        PolicyVault.Policy memory p = _policy();
        p.maxTradeUsd += 1;
        _expectQueued(p);
        p = _policy();
        p.maxDailyVolumeUsd += 1;
        _expectQueued(p);
        p = _policy();
        p.dailyLossBps += 1;
        _expectQueued(p);
        p = _policy();
        p.maxSlippageBps += 1;
        _expectQueued(p);
        p = _policy();
        p.cooldown -= 1;
        _expectQueued(p);
    }

    function _expectQueued(PolicyVault.Policy memory p) internal {
        vm.prank(owner);
        vault.proposePolicy(p);
        assertEq(keccak256(abi.encode(vault.getPolicy())), keccak256(abi.encode(_policy())));
        assertEq(vault.getPendingPolicy().eta, block.timestamp + LOOSEN_DELAY);
    }

    function test_MixedPolicyChangeWaitsAsAWhole() public {
        PolicyVault.Policy memory p = _policy();
        p.maxTradeUsd = 100 * USD;
        p.dailyLossBps = 2000;
        _expectQueued(p);
    }

    function test_GuardianCanVetoLoosening() public {
        PolicyVault.Policy memory p = _policy();
        p.maxTradeUsd = 50_000 * USD;
        vm.prank(owner);
        vault.proposePolicy(p);

        vm.prank(guardian);
        vault.cancelPolicy();

        vm.warp(block.timestamp + LOOSEN_DELAY);
        vm.expectRevert(PolicyVault.NoPendingChange.selector);
        vm.prank(owner);
        vault.applyPolicy();
        assertEq(vault.getPolicy().maxTradeUsd, MAX_TRADE);
    }

    function test_TighteningClearsAPendingLoosening() public {
        PolicyVault.Policy memory loose = _policy();
        loose.maxTradeUsd = 50_000 * USD;
        PolicyVault.Policy memory tight = _policy();
        tight.maxTradeUsd = 100 * USD;
        vm.startPrank(owner);
        vault.proposePolicy(loose);
        vault.proposePolicy(tight);
        vm.warp(block.timestamp + LOOSEN_DELAY);
        vm.expectRevert(PolicyVault.NoPendingChange.selector);
        vault.applyPolicy();
        vm.stopPrank();
        assertEq(vault.getPolicy().maxTradeUsd, 100 * USD);
    }

    function test_RevertWhen_PolicyIsInvalid() public {
        PolicyVault.Policy memory p = _policy();
        p.dailyLossBps = 10_001;
        vm.expectRevert(PolicyVault.InvalidPolicy.selector);
        vm.prank(owner);
        vault.proposePolicy(p);

        p = _policy();
        p.maxSlippageBps = 501;
        vm.expectRevert(PolicyVault.InvalidPolicy.selector);
        vm.prank(owner);
        vault.proposePolicy(p);

        p = _policy();
        p.cooldown = 30 days + 1;
        vm.expectRevert(PolicyVault.InvalidPolicy.selector);
        vm.prank(owner);
        vault.proposePolicy(p);
    }

    function test_DelistingIsInstant_SellingStillWorks() public {
        _buy(idx, 1_000 * USD);
        vm.prank(owner);
        vault.proposeAssetRule(address(idx), _rule(false, 5000, 0));

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.AssetNotAllowed.selector, address(idx)));
        _buy(idx, 100 * USD);
        _sell(idx, 9.97e18);
        assertEq(vault.holdings(address(idx)), 0);
    }

    function test_RaisingExposureCapWaits() public {
        vm.startPrank(owner);
        vault.proposeAssetRule(address(gold), _rule(true, 8000, 0));
        assertEq(vault.getRule(address(gold)).maxExposureBps, 2000);
        uint64 eta = uint64(block.timestamp) + LOOSEN_DELAY;

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ChangeNotReady.selector, eta));
        vault.applyAssetRule(address(gold));
        vm.warp(eta);
        vault.applyAssetRule(address(gold));
        vm.stopPrank();
        assertEq(vault.getRule(address(gold)).maxExposureBps, 8000);
    }

    /// The panic scene: the owner tries to allow a coin that is pumping.
    function test_AllowingANewAssetWaits_GuardianCanVeto() public {
        vm.prank(owner);
        vault.proposeAssetRule(address(meme), _rule(true, 10_000, 0));

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.AssetNotAllowed.selector, address(meme)));
        _buy(meme, 100 * USD);

        vm.prank(guardian);
        vault.cancelAssetRule(address(meme));
        vm.warp(block.timestamp + LOOSEN_DELAY);
        vm.expectRevert(PolicyVault.NoPendingChange.selector);
        vm.prank(owner);
        vault.applyAssetRule(address(meme));
        assertFalse(vault.getRule(address(meme)).allowed);
    }

    function test_NewAssetIsTradableAfterTheDelay() public {
        vm.startPrank(owner);
        vault.proposeAssetRule(address(meme), _rule(true, 500, 0));
        vm.warp(block.timestamp + LOOSEN_DELAY);
        vault.applyAssetRule(address(meme));
        vm.stopPrank();
        _refreshPrices();

        _buy(meme, 100 * USD);
        assertEq(vault.getAssets().length, 4);
        assertGt(vault.holdings(address(meme)), 0);
    }

    function test_RevertWhen_AssetHasNoPriceFeed() public {
        address unknown = makeAddr("unknown token");
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.NoFeed.selector, unknown));
        vm.prank(owner);
        vault.proposeAssetRule(unknown, _rule(true, 1000, 0));
    }

    function test_RevertWhen_RuleIsForTheStableAsset() public {
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.NotAnAsset.selector, address(usd)));
        vm.prank(owner);
        vault.proposeAssetRule(address(usd), _rule(true, 1000, 0));
    }

    function test_RevertWhen_InitializedTwice() public {
        address[] memory assets = new address[](1);
        assets[0] = address(meme);
        PolicyVault.AssetRule[] memory rules = new PolicyVault.AssetRule[](1);
        rules[0] = _rule(true, 10_000, 0);
        vm.expectRevert(PolicyVault.AlreadyInitialized.selector);
        vm.prank(owner);
        vault.initialize(_policy(), assets, rules);
    }

    function test_UninitializedVaultIsLocked() public {
        PolicyVault fresh = new PolicyVault(usd, oracle, exchange, owner, address(0), LOOSEN_DELAY, MAX_PRICE_AGE);
        usd.mint(owner, 1_000 * USD);
        vm.startPrank(owner);
        fresh.setAgent(agent, uint64(block.timestamp + 1 days));
        usd.approve(address(fresh), 1_000 * USD);
        fresh.deposit(address(usd), 1_000 * USD);
        vm.stopPrank();

        assertTrue(fresh.inProtectMode());
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.AssetNotAllowed.selector, address(idx)));
        vm.prank(agent);
        fresh.buy(address(idx), 1 * USD, REF);
    }

    function test_RevertWhen_TooManyAssets() public {
        PolicyVault fresh = new PolicyVault(usd, oracle, exchange, owner, guardian, LOOSEN_DELAY, MAX_PRICE_AGE);
        address[] memory assets = new address[](9);
        PolicyVault.AssetRule[] memory rules = new PolicyVault.AssetRule[](9);
        for (uint256 i = 0; i < 9; i++) {
            MockAsset a = new MockAsset("Extra", "EXTRA", address(exchange));
            oracle.addFeed(address(a), 1 * PRICE, 1000);
            assets[i] = address(a);
            rules[i] = _rule(true, 1000, 0);
        }
        vm.expectRevert(PolicyVault.TooManyAssets.selector);
        vm.prank(owner);
        fresh.initialize(_policy(), assets, rules);
    }

    // ---------------- roles ----------------

    function test_GuardianCanOnlySayNo() public {
        vm.startPrank(guardian);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.withdraw(address(usd), 1 * USD);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.proposePolicy(_policy());
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.approveRequest(1);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.setAgent(attacker, uint64(block.timestamp + 1 days));
        vm.expectRevert(PolicyVault.NotAgent.selector);
        vault.buy(address(idx), 1 * USD, REF);

        vault.pause();
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.unpause();
        vm.stopPrank();
        assertTrue(vault.paused());

        vm.prank(owner);
        vault.unpause();
        _buy(idx, 100 * USD);
    }

    function test_RevertWhen_StrangerPauses() public {
        vm.expectRevert(PolicyVault.NotOwnerOrGuardian.selector);
        vm.prank(stranger);
        vault.pause();
    }

    function test_OnlyGuardianCanPassOnTheGuardianRole() public {
        vm.expectRevert(PolicyVault.NotGuardian.selector);
        vm.prank(owner);
        vault.transferGuardian(stranger);
        vm.expectRevert(PolicyVault.GuardianAlreadySet.selector);
        vm.prank(owner);
        vault.setGuardian(stranger);

        vm.prank(guardian);
        vault.transferGuardian(stranger);
        assertEq(vault.guardian(), stranger);
        vm.prank(stranger);
        vault.pause();
        assertTrue(vault.paused());
    }

    function test_OwnerCanAppointAGuardianWhenThereIsNone() public {
        PolicyVault fresh = new PolicyVault(usd, oracle, exchange, owner, address(0), LOOSEN_DELAY, MAX_PRICE_AGE);
        vm.startPrank(owner);
        fresh.setGuardian(guardian);
        vm.expectRevert(PolicyVault.GuardianAlreadySet.selector);
        fresh.setGuardian(stranger);
        vm.stopPrank();
        assertEq(fresh.guardian(), guardian);
    }

    function test_RevertWhen_AgentKeyIsInvalid() public {
        vm.startPrank(owner);
        vm.expectRevert(PolicyVault.InvalidAgent.selector);
        vault.setAgent(address(0), uint64(block.timestamp + 1 days));
        vm.expectRevert(PolicyVault.InvalidAgent.selector);
        vault.setAgent(owner, uint64(block.timestamp + 1 days));
        vm.expectRevert(PolicyVault.InvalidAgent.selector);
        vault.setAgent(guardian, uint64(block.timestamp + 1 days));
        vm.expectRevert(PolicyVault.InvalidExpiry.selector);
        vault.setAgent(attacker, uint64(block.timestamp));
        vm.expectRevert(PolicyVault.InvalidExpiry.selector);
        vault.setAgent(attacker, uint64(block.timestamp + 90 days + 1));
        vm.stopPrank();
    }

    // ---------------- owner funds ----------------

    function test_WithdrawGoesToTheOwner_EvenWhilePaused() public {
        _buy(idx, 1_000 * USD);
        vm.prank(guardian);
        vault.pause();

        vm.startPrank(owner);
        vault.withdraw(address(usd), 2_000 * USD);
        vault.withdraw(address(idx), 9.97e18);
        vm.stopPrank();
        assertEq(usd.balanceOf(owner), 2_000 * USD);
        assertEq(idx.balanceOf(owner), 9.97e18);
        assertEq(vault.holdings(address(usd)), 7_000 * USD);
        assertEq(vault.holdings(address(idx)), 0);
    }

    function test_RevertWhen_WithdrawingMoreThanHeld() public {
        vm.expectRevert(
            abi.encodeWithSelector(PolicyVault.InsufficientBalance.selector, address(usd), FUNDS + 1, FUNDS)
        );
        vm.prank(owner);
        vault.withdraw(address(usd), FUNDS + 1);
    }

    function test_RevertWhen_DepositIsNotFromOwnerOrNotListed() public {
        usd.mint(stranger, 100 * USD);
        vm.startPrank(stranger);
        usd.approve(address(vault), 100 * USD);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.deposit(address(usd), 100 * USD);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.UnknownAsset.selector, address(meme)));
        vm.prank(owner);
        vault.deposit(address(meme), 1e18);
    }

    // ---------------- escalation ----------------

    function test_OwnerApprovesATradeAboveTheAgentLimit() public {
        vm.expectEmit(true, true, true, true);
        emit PolicyVault.TradeRequested(1, address(bond), true, 2_500 * USD, REF);
        vm.prank(agent);
        uint256 id = vault.requestTrade(address(bond), true, 2_500 * USD, REF);
        assertEq(vault.holdings(address(bond)), 0);

        vm.prank(owner);
        vault.approveRequest(id);
        assertEq(vault.holdings(address(bond)), 24.925e18);
        assertEq(vault.dailyVolumeRemaining(), MAX_DAILY);
        assertEq(uint8(vault.getRequest(id).status), uint8(PolicyVault.RequestStatus.Approved));

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.RequestNotPending.selector, id));
        vm.prank(owner);
        vault.approveRequest(id);
    }

    function test_OwnerApprovesALargeSell() public {
        _holdIndex();
        vm.prank(agent);
        uint256 id = vault.requestTrade(address(idx), false, 39.88e18, REF);
        vm.prank(owner);
        vault.approveRequest(id);
        assertEq(vault.holdings(address(idx)), 0);
    }

    function test_RevertWhen_ApprovedTradeBreaksExposureCap() public {
        vm.prank(agent);
        uint256 id = vault.requestTrade(address(gold), true, 5_000 * USD, REF);
        vm.expectPartialRevert(PolicyVault.ExceedsExposure.selector);
        vm.prank(owner);
        vault.approveRequest(id);
        assertEq(uint8(vault.getRequest(id).status), uint8(PolicyVault.RequestStatus.Pending));
    }

    function test_RevertWhen_ApprovedBuyIsInProtectMode() public {
        _holdIndex();
        _crashIndex();
        vm.prank(agent);
        uint256 id = vault.requestTrade(address(bond), true, 100 * USD, REF);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsDailyLoss.selector, 1084, DAILY_LOSS_BPS));
        vm.prank(owner);
        vault.approveRequest(id);
    }

    function test_GuardianCanRejectARequest() public {
        vm.prank(agent);
        uint256 id = vault.requestTrade(address(bond), true, 2_500 * USD, REF);
        vm.prank(guardian);
        vault.rejectRequest(id);

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.RequestNotPending.selector, id));
        vm.prank(owner);
        vault.approveRequest(id);
    }

    function test_RevertWhen_RequestExpired() public {
        vm.prank(agent);
        uint256 id = vault.requestTrade(address(bond), true, 2_500 * USD, REF);
        skip(1 days + 1);
        _refreshPrices();
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.RequestExpired.selector, id));
        vm.prank(owner);
        vault.approveRequest(id);
    }

    function test_RevertWhen_RequestIsForAnAssetOffTheAllowlist() public {
        vm.startPrank(agent);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.AssetNotAllowed.selector, address(meme)));
        vault.requestTrade(address(meme), true, 100 * USD, REF);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.UnknownAsset.selector, address(meme)));
        vault.requestTrade(address(meme), false, 1e18, REF);
        vm.stopPrank();
    }

    function test_RevertWhen_ApprovingWhilePaused() public {
        vm.prank(agent);
        uint256 id = vault.requestTrade(address(bond), true, 2_500 * USD, REF);
        vm.startPrank(owner);
        vault.pause();
        vm.expectRevert(PolicyVault.WalletPaused.selector);
        vault.approveRequest(id);
        vm.stopPrank();
    }

    // ---------------- what a compromised agent could still do ----------------

    function test_AgentExposureFollowsTheDailyVolume() public {
        (uint256 tradable, uint256 maxCost) = vault.agentExposure();
        assertEq(tradable, 3_000 * USD);
        assertEq(maxCost, 30 * USD);

        _buy(idx, 1_000 * USD);
        (tradable, maxCost) = vault.agentExposure();
        assertEq(tradable, 2_000 * USD);
        assertEq(maxCost, 20 * USD);
    }

    function test_AgentExposureIsZeroWhenTheKeyCannotAct() public {
        uint256 snap = vm.snapshotState();

        vm.prank(guardian);
        vault.pause();
        (uint256 tradable, uint256 maxCost) = vault.agentExposure();
        assertEq(tradable + maxCost, 0);

        vm.revertToState(snap);
        vm.prank(guardian);
        vault.revokeAgent();
        (tradable, maxCost) = vault.agentExposure();
        assertEq(tradable + maxCost, 0);

        vm.revertToState(snap);
        vm.warp(START + 60 days);
        (tradable, maxCost) = vault.agentExposure();
        assertEq(tradable + maxCost, 0);
    }

    // ---------------- fuzz ----------------

    function _pick(uint256 seed) internal view returns (MockAsset) {
        MockAsset[4] memory all = [idx, bond, gold, meme];
        return all[seed % 4];
    }

    /// Whatever the agent buys, the asset is on the allowlist and inside its cap afterwards.
    function testFuzz_BuyNeverBreaksAllowlistOrExposureCap(uint256 seed, uint256 usdIn, uint8 rounds) public {
        rounds = uint8(bound(rounds, 1, 6));
        for (uint256 i = 0; i < rounds; i++) {
            MockAsset asset = _pick(uint256(keccak256(abi.encode(seed, i))));
            uint256 amount = bound(uint256(keccak256(abi.encode(usdIn, i))), 0, 2 * MAX_TRADE);
            vm.prank(agent);
            try vault.buy(address(asset), amount, REF) {
                assertTrue(vault.getRule(address(asset)).allowed);
                assertLe(vault.exposureBps(address(asset)), vault.getRule(address(asset)).maxExposureBps);
                assertLe(amount, MAX_TRADE);
            } catch {}
        }
        assertEq(vault.holdings(address(meme)), 0);
        assertEq(meme.balanceOf(address(vault)), 0);
    }

    /// A trade never costs more against the oracle price than the slippage limit allows.
    function testFuzz_TradeCostIsBounded(uint256 usdIn, uint256 sellShare) public {
        usdIn = bound(usdIn, 1, MAX_TRADE);
        uint256 before = vault.portfolioValue();
        uint256 bought = _buy(idx, usdIn);
        uint256 afterBuy = vault.portfolioValue();
        assertLe(before - afterBuy, usdIn * SLIPPAGE_BPS / 10_000 + 1);

        uint256 amount = bound(sellShare, 0, bought);
        // the vault refuses a sell worth less than one stable unit
        if (amount < 1e10) return;
        uint256 sold = _sell(idx, amount);
        assertLe(afterBuy - vault.portfolioValue(), sold * SLIPPAGE_BPS / 10_000 + 2);
    }

    /// The agent's volume in one UTC day never passes the daily limit, whatever mix of trades it tries.
    function testFuzz_DailyVolumeIsNeverExceeded(uint256 seed) public {
        uint256 volume;
        for (uint256 i = 0; i < 12; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            MockAsset asset = _pick(r >> 8);
            uint256 usdBefore = vault.holdings(address(usd));
            vm.prank(agent);
            if (r % 2 == 0) {
                try vault.buy(address(asset), bound(r >> 16, 0, MAX_TRADE), REF) {
                    volume += usdBefore - vault.holdings(address(usd));
                } catch {}
            } else {
                try vault.sell(address(asset), bound(r >> 16, 0, vault.holdings(address(asset))), REF) {
                    // the gross value is what counts, which is the proceeds plus the 0.3% fee
                    volume += (vault.holdings(address(usd)) - usdBefore) * 10_000 / (10_000 - FEE_BPS);
                } catch {}
            }
        }
        assertLe(volume, MAX_DAILY + 12);
        assertEq(usd.balanceOf(agent), 0);
    }

    /// Any policy the owner proposes either tightens every field and applies now, or changes nothing yet.
    function testFuzz_PolicyChangeIsTighterOrQueued(uint256 a, uint256 b, uint16 c, uint16 d, uint32 e) public {
        PolicyVault.Policy memory p = PolicyVault.Policy({
            maxTradeUsd: a,
            maxDailyVolumeUsd: b,
            dailyLossBps: uint16(bound(c, 0, 10_000)),
            maxSlippageBps: uint16(bound(d, 0, 500)),
            cooldown: uint32(bound(e, 0, 30 days))
        });
        PolicyVault.Policy memory old = _policy();
        vm.prank(owner);
        vault.proposePolicy(p);

        PolicyVault.Policy memory cur = vault.getPolicy();
        if (keccak256(abi.encode(cur)) == keccak256(abi.encode(old))) {
            bool unchanged = keccak256(abi.encode(p)) == keccak256(abi.encode(old));
            assertTrue(unchanged || vault.getPendingPolicy().eta == block.timestamp + LOOSEN_DELAY);
        } else {
            assertEq(keccak256(abi.encode(cur)), keccak256(abi.encode(p)));
            assertLe(cur.maxTradeUsd, old.maxTradeUsd);
            assertLe(cur.maxDailyVolumeUsd, old.maxDailyVolumeUsd);
            assertLe(cur.dailyLossBps, old.dailyLossBps);
            assertLe(cur.maxSlippageBps, old.maxSlippageBps);
            assertGe(cur.cooldown, old.cooldown);
            assertEq(vault.getPendingPolicy().eta, 0);
        }
    }
}
