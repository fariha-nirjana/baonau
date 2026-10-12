// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

import {Mandate} from "../src/Mandate.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {AssetRule, Policy} from "../src/Types.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {MockAsset} from "../src/mocks/MockAsset.sol";
import {PriceOracle} from "../src/mocks/PriceOracle.sol";
import {SkimmingExchange} from "./utils/SkimmingExchange.sol";
import {VaultFixture} from "./utils/VaultFixture.sol";

contract PolicyVaultTest is VaultFixture {
    function _rule(bool allowed, uint16 capBps, uint256 stopPrice) internal pure returns (AssetRule memory) {
        return AssetRule(allowed, false, capBps, stopPrice);
    }

    /// Three 10% drops take the index from 100 to 72.9, a 10.84% loss on the day for the portfolio.
    function _crashIndex() internal {
        _setPrice(idx, 90 * PRICE);
        _setPrice(idx, 81 * PRICE);
        _setPrice(idx, 729 * PRICE / 10);
    }

    function _setStop(uint256 stopPrice) internal {
        vm.prank(owner);
        mandate.proposeAssetRule(address(idx), _rule(true, 5000, stopPrice));
    }

    // ---------------- agent: allowed ----------------

    function test_AgentBuysAllowlistedAsset() public {
        vm.expectEmit(true, true, true, true);
        emit Trade(address(idx), true, 1_000 * USD, 9.97e18, 100 * PRICE, REF, agent);
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
        // 30% of what the portfolio is worth on the new day, 9,991 after three fees
        assertEq(vault.dailyVolumeRemaining(), 2_997_300_000);
        _buy(bond, 500 * USD);
        assertEq(vault.dailyVolumeRemaining(), 2_997_300_000 - 500 * USD);
    }

    // ---------------- agent: blocked ----------------

    function test_RevertWhen_CallerIsNotAgent() public {
        vm.expectRevert(Mandate.NotAgent.selector);
        vm.prank(attacker);
        vault.buy(address(idx), 100 * USD, REF);

        vm.expectRevert(Mandate.NotAgent.selector);
        vm.prank(attacker);
        vault.sell(address(idx), 1, REF);
    }

    function test_RevertWhen_AgentKeyExpired() public {
        vm.warp(START + 60 days);
        vm.expectRevert(Mandate.AgentKeyExpired.selector);
        _buy(idx, 100 * USD);
    }

    function test_RevertWhen_AgentRevoked() public {
        vm.prank(guardian);
        mandate.revokeAgent();
        vm.expectRevert(Mandate.NotAgent.selector);
        _buy(idx, 100 * USD);
    }

    function test_RevertWhen_Paused() public {
        vm.prank(guardian);
        mandate.pause();
        vm.expectRevert(Mandate.AgentPaused.selector);
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
        // 11% of a 10,000 tUSD portfolio
        uint256 limit = 1_100 * USD;
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsTradeLimit.selector, limit + 1, limit));
        _buy(idx, limit + 1);
        _buy(idx, limit);
    }

    function test_TradeLimitFollowsThePortfolioValue() public {
        vm.prank(owner);
        vault.withdraw(address(usd), 9_000 * USD);
        // the same 11%, now of 1,000 tUSD
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsTradeLimit.selector, 111 * USD, 110 * USD));
        _buy(idx, 111 * USD);
        _buy(idx, 110 * USD);
        // and the day's volume is 30% of it
        assertEq(vault.dailyVolumeRemaining(), 300 * USD - 110 * USD);
    }

    function test_RevertWhen_SellOverTradeLimit() public {
        _buy(idx, 1_000 * USD);
        _buy(idx, 1_000 * USD);
        // 19.94 units at 100 is 1,994 tUSD, above 11% of the 9,994 the portfolio is worth
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsTradeLimit.selector, 1_994 * USD, 1_099_340_000));
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
        // a signed approval has no size limit, so it can ask for more cash than there is
        vm.prank(owner);
        vault.withdraw(address(usd), FUNDS - 500 * USD);
        (PolicyVault.TradeApproval memory a, bytes memory sig) = _approval(true, bond, 600 * USD, 1, 1 hours, OWNER_KEY);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyVault.InsufficientBalance.selector, address(usd), 600 * USD, 500 * USD)
        );
        vm.prank(agent);
        vault.tradeWithApproval(a, sig, REF);
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

    /// The agent key has no way to touch the mandate or the funds.
    function test_RevertWhen_AgentCallsOwnerFunctions() public {
        (address[] memory assets, AssetRule[] memory rules) = _assetRules();
        Policy memory loose = _policy();
        loose.maxTradeBps = 10_000;
        bytes32 policyKey = mandate.POLICY_CHANGE();

        vm.startPrank(agent);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.withdraw(address(usd), 1 * USD);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.deposit(address(usd), 1 * USD);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.sweep(address(usd));
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.cancelApproval(1);

        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.signMandate(loose, assets, rules, agent, AGENT_EXPIRY);
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.proposePolicy(loose);
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.applyPolicy();
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.proposeAssetRule(address(meme), _rule(true, 10_000, 0));
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.applyAssetRule(address(meme));
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.proposeWithdrawalAddress(agent);
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.applyWithdrawalAddress();
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.applyStopLossHalt();
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.setAgent(agent, uint64(block.timestamp + 90 days));
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.applyAgent();
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.setGuardian(agent);
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.applyGuardian();
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.setLoosenDelay(1 minutes);
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.applyLoosenDelay();
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.applyUnpause();
        vm.expectRevert(Mandate.NotOwnerOrGuardian.selector);
        mandate.pause();
        vm.expectRevert(Mandate.NotOwnerOrGuardian.selector);
        mandate.unpause();
        vm.expectRevert(Mandate.NotOwnerOrGuardian.selector);
        mandate.haltStopLoss();
        vm.expectRevert(Mandate.NotOwnerOrGuardian.selector);
        mandate.resumeStopLoss();
        vm.expectRevert(Mandate.NotOwnerOrGuardian.selector);
        mandate.revokeAgent();
        vm.expectRevert(Mandate.NotOwnerOrGuardian.selector);
        mandate.cancelChange(policyKey);
        vm.expectRevert(Mandate.NotVault.selector);
        mandate.terminate();
        vm.stopPrank();
    }

    // ---------------- execution quality ----------------

    /// A second vault for the same owner, on a factory whose exchange is the dishonest venue.
    function _vaultOn(SkimmingExchange venue) internal returns (PolicyVault v) {
        VaultFactory other = new VaultFactory(usd, oracle, venue, MAX_PRICE_AGE);
        address[] memory assets = new address[](1);
        assets[0] = address(idx);
        AssetRule[] memory rules = new AssetRule[](1);
        rules[0] = _rule(true, 10_000, 0);

        // stock the venue and the owner with index units bought on the honest exchange
        usd.mint(address(this), 20_000 * USD);
        usd.approve(address(exchange), 20_000 * USD);
        exchange.buy(address(idx), 20_000 * USD, 0);
        idx.transfer(address(venue), 100e18);
        idx.transfer(owner, 50e18);

        usd.mint(owner, FUNDS);
        vm.startPrank(owner);
        Mandate m;
        (m, v) = other.createVault(guardian, LOOSEN_DELAY);
        m.signMandate(_policy(), assets, rules, agent, uint64(block.timestamp + 60 days));
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
        emit ProtectModeEntered(PolicyVault.Trigger.DailyLoss, 1084, uint64(block.timestamp + COOLDOWN));
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

    // ---------------- minimum defensive share ----------------

    function test_RevertWhen_BuyLeavesTooLittleInDefensiveAssets() public {
        Policy memory p = _policy();
        p.minDefensiveBps = 7000;
        vm.prank(owner);
        mandate.proposePolicy(p);

        _buy(idx, 1_000 * USD);
        _buy(idx, 1_000 * USD);
        _buy(idx, 1_000 * USD);
        assertEq(vault.defensiveBps(), 7006);
        skip(1 days);
        _refreshPrices();
        // a fourth buy would leave 6,000 of 9,988 in cash
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.BelowDefensiveFloor.selector, 6007, 7000));
        _buy(idx, 1_000 * USD);
        // the bond fund is defensive, so buying it is still fine and only the fee moves the share
        _buy(bond, 1_000 * USD);
        assertEq(vault.defensiveBps(), 7005);
    }

    function test_DefensiveShareCountsCashAndDefensiveAssets() public {
        _buy(bond, 1_000 * USD);
        _buy(bond, 1_000 * USD);
        _buy(gold, 1_000 * USD);
        // 7,000 cash plus 1,994 in the bond fund, of 9,991
        assertEq(vault.defensiveBps(), 9002);
    }

    function test_MarkingAnAssetDefensiveWaits_UnmarkingIsInstant() public {
        vm.startPrank(owner);
        mandate.proposeAssetRule(address(gold), AssetRule(true, true, 2000, 0));
        assertFalse(mandate.getRule(address(gold)).defensive);
        assertEq(mandate.pendingEta(mandate.ruleKey(address(gold))), block.timestamp + LOOSEN_DELAY);

        mandate.proposeAssetRule(address(bond), AssetRule(true, false, 6000, 0));
        assertFalse(mandate.getRule(address(bond)).defensive);
        vm.stopPrank();
    }

    // ---------------- loss streak ----------------

    function test_ThreeLosingSellsInARowStartACooldown() public {
        _buy(idx, 1_000 * USD);
        // selling at the price just paid loses the two fees
        _sell(idx, 2e18);
        _sell(idx, 2e18);
        assertEq(vault.lossStreak(), 2);
        assertEq(vault.cooldownUntil(), 0);

        vm.expectEmit(true, true, true, true);
        emit ProtectModeEntered(PolicyVault.Trigger.LossStreak, 0, uint64(block.timestamp + COOLDOWN));
        _sell(idx, 2e18);
        assertEq(vault.lossStreak(), 0);

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.CooldownActive.selector, block.timestamp + COOLDOWN));
        _buy(bond, 100 * USD);
        // selling is never blocked
        _sell(idx, 1e18);
    }

    function test_AWinningSellResetsTheLossStreak() public {
        _buy(idx, 1_000 * USD);
        _sell(idx, 2e18);
        _sell(idx, 2e18);
        assertEq(vault.lossStreak(), 2);

        _setPrice(idx, 110 * PRICE);
        _sell(idx, 2e18);
        assertEq(vault.lossStreak(), 0);
        assertEq(vault.cooldownUntil(), 0);
    }

    function test_CostBasisFollowsBuysSellsAndWithdrawals() public {
        _buy(idx, 1_000 * USD);
        assertEq(vault.costBasis(address(idx)), 1_000 * USD);
        _sell(idx, 4.985e18);
        assertEq(vault.costBasis(address(idx)), 500 * USD);
        vm.prank(owner);
        vault.withdraw(address(idx), 4.985e18);
        assertEq(vault.costBasis(address(idx)), 0);
    }

    // ---------------- stop-loss ----------------

    function test_AnyoneCanTriggerStopLoss() public {
        _setStop(90 * PRICE);
        _holdIndex();
        _setPrice(idx, 90 * PRICE);
        uint256 volumeLeft = vault.dailyVolumeRemaining();

        vm.expectEmit(true, true, true, true);
        emit StopLossTriggered(address(idx), 39.88e18, 3_578_432_400, 90 * PRICE, stranger);
        vm.expectEmit(true, true, true, true);
        emit ProtectModeEntered(PolicyVault.Trigger.StopLoss, 0, uint64(block.timestamp + COOLDOWN));
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
        mandate.revokeAgent();
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

    /// Threat B: an owner who pauses in a crash does not switch off their own protection.
    function test_StopLossStillFiresWhileTheAgentIsPaused() public {
        _setStop(90 * PRICE);
        _holdIndex();
        _setPrice(idx, 90 * PRICE);
        vm.prank(owner);
        mandate.pause();

        vm.prank(stranger);
        vault.triggerStopLoss(address(idx));
        assertEq(vault.holdings(address(idx)), 0);
    }

    function test_OwnerHaltOfTheStopLossWaits() public {
        _setStop(90 * PRICE);
        _holdIndex();
        _setPrice(idx, 90 * PRICE);

        vm.startPrank(owner);
        vm.expectEmit(true, true, true, true);
        emit StopLossHaltProposed(uint64(block.timestamp) + LOOSEN_DELAY);
        mandate.haltStopLoss();
        assertEq(mandate.stopLossHaltedUntil(), 0);
        vm.expectRevert(abi.encodeWithSelector(Mandate.ChangeNotReady.selector, block.timestamp + LOOSEN_DELAY));
        mandate.applyStopLossHalt();
        vm.stopPrank();

        // so the stop-loss the owner wanted to stop still fires
        vm.prank(stranger);
        vault.triggerStopLoss(address(idx));
        assertEq(vault.holdings(address(idx)), 0);
    }

    function test_OwnerHaltAppliesAfterTheDelay_UnlessTheGuardianVetoes() public {
        bytes32 key = mandate.HALT_CHANGE();
        vm.prank(owner);
        mandate.haltStopLoss();
        uint256 snap = vm.snapshotState();

        skip(LOOSEN_DELAY);
        vm.prank(owner);
        mandate.applyStopLossHalt();
        assertEq(mandate.stopLossHaltedUntil(), block.timestamp + 3 days);

        vm.revertToState(snap);
        vm.prank(guardian);
        mandate.cancelChange(key);
        skip(LOOSEN_DELAY);
        vm.expectRevert(Mandate.NoPendingChange.selector);
        vm.prank(owner);
        mandate.applyStopLossHalt();
        assertEq(mandate.stopLossHaltedUntil(), 0);
    }

    /// The guardian's emergency brake, for a price feed that has gone wrong.
    function test_GuardianHaltsTheStopLossAtOnce() public {
        _setStop(90 * PRICE);
        _holdIndex();
        _setPrice(idx, 90 * PRICE);

        vm.prank(guardian);
        mandate.haltStopLoss();
        uint64 until = uint64(block.timestamp + 3 days);
        assertEq(mandate.stopLossHaltedUntil(), until);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.StopLossIsHalted.selector, until));
        vault.triggerStopLoss(address(idx));

        // resuming makes the vault stricter, so it is instant for either of them
        vm.prank(owner);
        mandate.resumeStopLoss();
        vault.triggerStopLoss(address(idx));
        assertEq(vault.holdings(address(idx)), 0);
    }

    function test_AHaltLapsesOnItsOwn() public {
        _setStop(90 * PRICE);
        _holdIndex();
        _setPrice(idx, 90 * PRICE);
        vm.prank(guardian);
        mandate.haltStopLoss();

        skip(3 days);
        _refreshPrices();
        vault.triggerStopLoss(address(idx));
        assertEq(vault.holdings(address(idx)), 0);
    }

    function test_RevertWhen_StrangerHaltsTheStopLoss() public {
        vm.expectRevert(Mandate.NotOwnerOrGuardian.selector);
        vm.prank(stranger);
        mandate.haltStopLoss();
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
        assertEq(mandate.getRule(address(idx)).stopPrice, 90 * PRICE);

        _setStop(95 * PRICE);
        assertEq(mandate.getRule(address(idx)).stopPrice, 95 * PRICE);

        _setStop(50 * PRICE);
        assertEq(mandate.getRule(address(idx)).stopPrice, 95 * PRICE);
        assertEq(mandate.pendingEta(mandate.ruleKey(address(idx))), block.timestamp + LOOSEN_DELAY);
        assertEq(mandate.getPendingRule(address(idx)).stopPrice, 50 * PRICE);
    }

    // ---------------- policy changes: stricter is instant, looser waits ----------------

    function test_TighteningPolicyIsInstant() public {
        Policy memory p = _policy();
        p.maxTradeBps = 200;
        p.dailyLossBps = 300;
        p.minDefensiveBps = 5000;
        p.maxLossStreak = 2;
        p.cooldown = 1 days;
        vm.prank(owner);
        mandate.proposePolicy(p);

        assertEq(keccak256(abi.encode(mandate.getPolicy())), keccak256(abi.encode(p)));
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsTradeLimit.selector, 201 * USD, 200 * USD));
        _buy(idx, 201 * USD);
    }

    function test_LooseningPolicyWaitsForTheDelay() public {
        bytes32 key = mandate.POLICY_CHANGE();
        Policy memory p = _policy();
        p.dailyLossBps = 5000;
        vm.startPrank(owner);
        mandate.proposePolicy(p);
        assertEq(mandate.getPolicy().dailyLossBps, DAILY_LOSS_BPS);
        uint64 eta = uint64(block.timestamp) + LOOSEN_DELAY;
        assertEq(mandate.pendingEta(key), eta);
        assertEq(mandate.getPendingPolicy().dailyLossBps, 5000);

        vm.expectRevert(abi.encodeWithSelector(Mandate.ChangeNotReady.selector, eta));
        mandate.applyPolicy();

        vm.warp(eta);
        mandate.applyPolicy();
        vm.stopPrank();
        assertEq(mandate.getPolicy().dailyLossBps, 5000);
        assertEq(mandate.pendingEta(key), 0);
    }

    function test_EveryLooseningDirectionWaits() public {
        Policy memory p = _policy();
        p.maxTradeBps += 1;
        _expectQueued(p);
        p = _policy();
        p.maxDailyVolumeBps += 1;
        _expectQueued(p);
        p = _policy();
        p.dailyLossBps += 1;
        _expectQueued(p);
        p = _policy();
        p.maxSlippageBps += 1;
        _expectQueued(p);
        p = _policy();
        p.minDefensiveBps -= 1;
        _expectQueued(p);
        p = _policy();
        p.maxLossStreak += 1;
        _expectQueued(p);
        // zero switches the streak rule off
        p = _policy();
        p.maxLossStreak = 0;
        _expectQueued(p);
        p = _policy();
        p.cooldown -= 1;
        _expectQueued(p);
    }

    function _expectQueued(Policy memory p) internal {
        vm.prank(owner);
        mandate.proposePolicy(p);
        assertEq(keccak256(abi.encode(mandate.getPolicy())), keccak256(abi.encode(_policy())));
        assertEq(mandate.pendingEta(mandate.POLICY_CHANGE()), block.timestamp + LOOSEN_DELAY);
    }

    function test_MixedPolicyChangeWaitsAsAWhole() public {
        Policy memory p = _policy();
        p.maxTradeBps = 100;
        p.dailyLossBps = 2000;
        _expectQueued(p);
    }

    /// Threat B: after a loss the owner tries to triple the risk limit. The guardian says no.
    function test_GuardianCanVetoLoosening() public {
        bytes32 key = mandate.POLICY_CHANGE();
        Policy memory p = _policy();
        p.dailyLossBps = DAILY_LOSS_BPS * 3;
        vm.prank(owner);
        mandate.proposePolicy(p);

        vm.expectEmit(true, true, true, true);
        emit ChangeCancelled(key, guardian);
        vm.prank(guardian);
        mandate.cancelChange(key);

        vm.warp(block.timestamp + LOOSEN_DELAY);
        vm.expectRevert(Mandate.NoPendingChange.selector);
        vm.prank(owner);
        mandate.applyPolicy();
        assertEq(mandate.getPolicy().dailyLossBps, DAILY_LOSS_BPS);
    }

    function test_TighteningClearsAPendingLoosening() public {
        Policy memory loose = _policy();
        loose.maxTradeBps = 9000;
        Policy memory tight = _policy();
        tight.maxTradeBps = 100;
        vm.startPrank(owner);
        mandate.proposePolicy(loose);
        mandate.proposePolicy(tight);
        vm.warp(block.timestamp + LOOSEN_DELAY);
        vm.expectRevert(Mandate.NoPendingChange.selector);
        mandate.applyPolicy();
        vm.stopPrank();
        assertEq(mandate.getPolicy().maxTradeBps, 100);
    }

    function test_RevertWhen_PolicyIsInvalid() public {
        Policy memory p = _policy();
        p.dailyLossBps = 10_001;
        _expectInvalid(p);
        p = _policy();
        p.maxTradeBps = 10_001;
        _expectInvalid(p);
        p = _policy();
        p.minDefensiveBps = 10_001;
        _expectInvalid(p);
        p = _policy();
        p.maxSlippageBps = 501;
        _expectInvalid(p);
        p = _policy();
        p.cooldown = 30 days + 1;
        _expectInvalid(p);
    }

    function _expectInvalid(Policy memory p) internal {
        vm.expectRevert(Mandate.InvalidPolicy.selector);
        vm.prank(owner);
        mandate.proposePolicy(p);
    }

    function test_DelistingIsInstant_SellingStillWorks() public {
        _buy(idx, 1_000 * USD);
        vm.prank(owner);
        mandate.proposeAssetRule(address(idx), _rule(false, 5000, 0));

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.AssetNotAllowed.selector, address(idx)));
        _buy(idx, 100 * USD);
        _sell(idx, 9.97e18);
        assertEq(vault.holdings(address(idx)), 0);
    }

    function test_RaisingExposureCapWaits() public {
        vm.startPrank(owner);
        mandate.proposeAssetRule(address(gold), _rule(true, 8000, 0));
        assertEq(mandate.getRule(address(gold)).maxExposureBps, 2000);
        uint64 eta = uint64(block.timestamp) + LOOSEN_DELAY;

        vm.expectRevert(abi.encodeWithSelector(Mandate.ChangeNotReady.selector, eta));
        mandate.applyAssetRule(address(gold));
        vm.warp(eta);
        mandate.applyAssetRule(address(gold));
        vm.stopPrank();
        assertEq(mandate.getRule(address(gold)).maxExposureBps, 8000);
    }

    /// The panic scene: the owner tries to allow a coin that is pumping.
    function test_AllowingANewAssetWaits_GuardianCanVeto() public {
        vm.prank(owner);
        mandate.proposeAssetRule(address(meme), _rule(true, 10_000, 0));

        vm.expectRevert(abi.encodeWithSelector(PolicyVault.AssetNotAllowed.selector, address(meme)));
        _buy(meme, 100 * USD);

        bytes32 key = mandate.ruleKey(address(meme));
        vm.prank(guardian);
        mandate.cancelChange(key);
        vm.warp(block.timestamp + LOOSEN_DELAY);
        vm.expectRevert(Mandate.NoPendingChange.selector);
        vm.prank(owner);
        mandate.applyAssetRule(address(meme));
        assertFalse(mandate.getRule(address(meme)).allowed);
    }

    function test_NewAssetIsTradableAfterTheDelay() public {
        vm.startPrank(owner);
        mandate.proposeAssetRule(address(meme), _rule(true, 500, 0));
        vm.warp(block.timestamp + LOOSEN_DELAY);
        mandate.applyAssetRule(address(meme));
        vm.stopPrank();
        _refreshPrices();

        _buy(meme, 100 * USD);
        assertEq(mandate.getAssets().length, 4);
        assertGt(vault.holdings(address(meme)), 0);
    }

    function test_RevertWhen_AssetHasNoPriceFeed() public {
        address unknown = makeAddr("unknown token");
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.NoFeed.selector, unknown));
        vm.prank(owner);
        mandate.proposeAssetRule(unknown, _rule(true, 1000, 0));
    }

    function test_RevertWhen_RuleIsForTheStableAsset() public {
        vm.expectRevert(abi.encodeWithSelector(Mandate.NotAnAsset.selector, address(usd)));
        vm.prank(owner);
        mandate.proposeAssetRule(address(usd), _rule(true, 1000, 0));
    }

    function test_RevertWhen_MandateSignedTwice() public {
        (address[] memory assets, AssetRule[] memory rules) = _assetRules();
        vm.expectRevert(Mandate.AlreadySigned.selector);
        vm.prank(owner);
        mandate.signMandate(_policy(), assets, rules, agent, AGENT_EXPIRY);
    }

    function test_RevertWhen_TooManyAssets() public {
        vm.prank(stranger);
        (Mandate fresh,) = factory.createVault(guardian, LOOSEN_DELAY);
        address[] memory assets = new address[](9);
        AssetRule[] memory rules = new AssetRule[](9);
        for (uint256 i = 0; i < 9; i++) {
            MockAsset a = new MockAsset("Extra", "EXTRA", address(exchange));
            oracle.addFeed(address(a), 1 * PRICE, 1000);
            assets[i] = address(a);
            rules[i] = _rule(true, 1000, 0);
        }
        vm.expectRevert(Mandate.TooManyAssets.selector);
        vm.prank(stranger);
        fresh.signMandate(_policy(), assets, rules, agent, AGENT_EXPIRY);
    }

    // ---------------- the factory, and vaults as copies ----------------

    function test_VaultAndMandateAreBoundToEachOther() public view {
        assertEq(address(vault.mandate()), address(mandate));
        assertEq(mandate.vault(), address(vault));
        assertEq(mandate.owner(), owner);
        assertTrue(factory.isVault(address(vault)));
        assertEq(address(factory.latestMandate(owner)), address(mandate));
    }

    function test_RevertWhen_ACopyIsSetUpAgain() public {
        vm.expectRevert("Initializable: contract is already initialized");
        mandate.init(attacker, address(0), attacker, address(usd), oracle, LOOSEN_DELAY, 0);
        vm.expectRevert("Initializable: contract is already initialized");
        vault.init(Mandate(attacker), usd, oracle, exchange, MAX_PRICE_AGE);
        // the owner cannot do it either
        vm.startPrank(owner);
        vm.expectRevert("Initializable: contract is already initialized");
        mandate.init(owner, address(0), address(vault), address(usd), oracle, 1 minutes, 0);
        vm.expectRevert("Initializable: contract is already initialized");
        vault.init(mandate, usd, oracle, exchange, MAX_PRICE_AGE);
        vm.stopPrank();
    }

    function test_RevertWhen_ATemplateIsSetUp() public {
        Mandate template = Mandate(factory.mandateTemplate());
        vm.expectRevert("Initializable: contract is already initialized");
        template.init(attacker, address(0), attacker, address(usd), oracle, LOOSEN_DELAY, 0);
        PolicyVault vaultTemplate = PolicyVault(factory.vaultTemplate());
        vm.expectRevert("Initializable: contract is already initialized");
        vaultTemplate.init(mandate, usd, oracle, exchange, MAX_PRICE_AGE);
    }

    function test_AVaultWithNoSignedMandateIsLocked() public {
        usd.mint(stranger, 1_000 * USD);
        vm.startPrank(stranger);
        (, PolicyVault fresh) = factory.createVault(address(0), LOOSEN_DELAY);
        usd.approve(address(fresh), 1_000 * USD);
        fresh.deposit(address(usd), 1_000 * USD);
        vm.stopPrank();

        assertTrue(fresh.inProtectMode());
        (uint256 tradable,) = fresh.agentExposure();
        assertEq(tradable, 0);
        vm.expectRevert(Mandate.NotAgent.selector);
        vm.prank(agent);
        fresh.buy(address(idx), 1 * USD, REF);
    }

    /// Leaving a vault and opening a new one is not a way around the wait:
    /// only an owner's first vault can have its mandate signed at once.
    function test_ALaterVaultOfTheSameOwnerWaitsBeforeItsFirstMandate() public {
        (address[] memory assets, AssetRule[] memory rules) = _assetRules();
        Policy memory loose = _policy();
        loose.dailyLossBps = 10_000;
        loose.maxTradeBps = 10_000;

        vm.startPrank(owner);
        vault.withdraw(address(usd), FUNDS);
        uint64 activeFrom = uint64(block.timestamp) + LOOSEN_DELAY;
        vm.expectEmit(true, false, false, false);
        emit VaultCreated(owner, address(0), address(0), activeFrom);
        (Mandate second,) = factory.createVault(address(0), 1 minutes);
        assertEq(second.activeFrom(), activeFrom);

        vm.expectRevert(abi.encodeWithSelector(Mandate.NotActiveYet.selector, activeFrom));
        second.signMandate(loose, assets, rules, agent, AGENT_EXPIRY);

        vm.warp(activeFrom);
        second.signMandate(loose, assets, rules, agent, AGENT_EXPIRY);
        vm.stopPrank();
        assertTrue(second.signed());
    }

    function test_AnotherOwnersFirstVaultStartsAtOnce() public {
        (address[] memory assets, AssetRule[] memory rules) = _assetRules();
        vm.startPrank(stranger);
        (Mandate theirs,) = factory.createVault(address(0), LOOSEN_DELAY);
        assertEq(theirs.activeFrom(), block.timestamp);
        theirs.signMandate(_policy(), assets, rules, agent, AGENT_EXPIRY);
        vm.stopPrank();
        assertEq(factory.vaultCount(), 2);
    }

    function test_RevertWhen_WaitingPeriodIsOutOfRange() public {
        vm.startPrank(stranger);
        vm.expectRevert(Mandate.InvalidDelay.selector);
        factory.createVault(address(0), 59);
        vm.expectRevert(Mandate.InvalidDelay.selector);
        factory.createVault(address(0), 30 days + 1);
        vm.stopPrank();
    }

    // ---------------- pausing ----------------

    function test_OwnerUndoesTheirOwnPauseAtOnce() public {
        vm.startPrank(owner);
        mandate.pause();
        vm.stopPrank();
        vm.expectRevert(Mandate.AgentPaused.selector);
        _buy(idx, 100 * USD);

        vm.prank(owner);
        mandate.unpause();
        assertFalse(mandate.paused());
        _buy(idx, 100 * USD);
    }

    /// The guardian's pause holds against the owner. Lifting it is a rise in risk, so it waits.
    function test_OwnerCannotLiftAGuardianPauseAtOnce() public {
        vm.prank(guardian);
        mandate.pause();
        assertTrue(mandate.pausedByGuardian());

        vm.startPrank(owner);
        vm.expectEmit(true, true, true, true);
        emit UnpauseProposed(uint64(block.timestamp) + LOOSEN_DELAY);
        mandate.unpause();
        assertTrue(mandate.paused());
        vm.expectRevert(abi.encodeWithSelector(Mandate.ChangeNotReady.selector, block.timestamp + LOOSEN_DELAY));
        mandate.applyUnpause();

        skip(LOOSEN_DELAY);
        mandate.applyUnpause();
        vm.stopPrank();
        assertFalse(mandate.paused());
        assertFalse(mandate.pausedByGuardian());
    }

    function test_GuardianLiftsTheirOwnPauseAtOnce_AndCanVetoTheOwnersUnpause() public {
        bytes32 key = mandate.UNPAUSE_CHANGE();
        vm.prank(guardian);
        mandate.pause();
        vm.prank(owner);
        mandate.unpause();

        vm.prank(guardian);
        mandate.cancelChange(key);
        skip(LOOSEN_DELAY);
        vm.expectRevert(Mandate.NoPendingChange.selector);
        vm.prank(owner);
        mandate.applyUnpause();
        assertTrue(mandate.paused());

        vm.prank(guardian);
        mandate.unpause();
        assertFalse(mandate.paused());
    }

    function test_AGuardianPauseOnTopOfAnOwnerPauseBelongsToTheGuardian() public {
        vm.prank(owner);
        mandate.pause();
        vm.prank(guardian);
        mandate.pause();

        vm.prank(owner);
        mandate.unpause();
        assertTrue(mandate.paused());
        assertEq(mandate.pendingEta(mandate.UNPAUSE_CHANGE()), block.timestamp + LOOSEN_DELAY);
    }

    function test_RevertWhen_StrangerPauses() public {
        vm.expectRevert(Mandate.NotOwnerOrGuardian.selector);
        vm.prank(stranger);
        mandate.pause();
    }

    // ---------------- the guardian ----------------

    function test_GuardianCanOnlySayNo() public {
        vm.startPrank(guardian);
        vm.expectRevert(PolicyVault.NotOwner.selector);
        vault.withdraw(address(usd), 1 * USD);
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.proposePolicy(_policy());
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.setAgent(attacker, uint64(block.timestamp + 1 days));
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.setGuardian(attacker);
        vm.expectRevert(Mandate.NotOwner.selector);
        mandate.proposeWithdrawalAddress(guardian);
        vm.expectRevert(Mandate.NotAgent.selector);
        vault.buy(address(idx), 1 * USD, REF);
        vm.stopPrank();
    }

    function test_AppointingAGuardianWhereThereIsNoneIsInstant() public {
        vm.startPrank(stranger);
        (Mandate fresh,) = factory.createVault(address(0), LOOSEN_DELAY);
        vm.expectRevert(Mandate.ZeroAddress.selector);
        fresh.setGuardian(address(0));
        fresh.setGuardian(guardian);
        vm.stopPrank();
        assertEq(fresh.guardian(), guardian);
    }

    /// Removing or replacing the guardian waits, and the guardian cannot cancel
    /// that one change, so an owner is never bound to a guardian for good.
    function test_RemovingTheGuardianWaits_AndTheGuardianCannotVetoIt() public {
        bytes32 key = mandate.GUARDIAN_CHANGE();
        vm.startPrank(owner);
        vm.expectEmit(true, true, true, true);
        emit GuardianProposed(address(0), uint64(block.timestamp) + LOOSEN_DELAY);
        mandate.setGuardian(address(0));
        vm.stopPrank();
        assertEq(mandate.guardian(), guardian);

        vm.expectRevert(Mandate.NotVetoable.selector);
        vm.prank(guardian);
        mandate.cancelChange(key);

        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(Mandate.ChangeNotReady.selector, block.timestamp + LOOSEN_DELAY));
        mandate.applyGuardian();
        skip(LOOSEN_DELAY);
        mandate.applyGuardian();
        vm.stopPrank();
        assertEq(mandate.guardian(), address(0));
    }

    /// An owner in a hurry faces two waits: one to remove the guardian, another to loosen anything.
    function test_LooseningAfterRemovingTheGuardianTakesAnotherFullWait() public {
        vm.startPrank(owner);
        mandate.setGuardian(address(0));
        skip(LOOSEN_DELAY);
        mandate.applyGuardian();

        Policy memory p = _policy();
        p.dailyLossBps = DAILY_LOSS_BPS * 3;
        mandate.proposePolicy(p);
        assertEq(mandate.getPolicy().dailyLossBps, DAILY_LOSS_BPS);
        vm.expectRevert(abi.encodeWithSelector(Mandate.ChangeNotReady.selector, block.timestamp + LOOSEN_DELAY));
        mandate.applyPolicy();
        vm.stopPrank();
    }

    function test_ReplacingTheGuardianWaits_AndTheOwnerCanDropTheRequest() public {
        bytes32 key = mandate.GUARDIAN_CHANGE();
        vm.startPrank(owner);
        mandate.setGuardian(stranger);
        assertEq(mandate.guardian(), guardian);
        mandate.cancelChange(key);
        skip(LOOSEN_DELAY);
        vm.expectRevert(Mandate.NoPendingChange.selector);
        mandate.applyGuardian();

        mandate.setGuardian(stranger);
        skip(LOOSEN_DELAY);
        mandate.applyGuardian();
        vm.stopPrank();
        assertEq(mandate.guardian(), stranger);
        // the old guardian has no say any more, the new one does
        vm.expectRevert(Mandate.NotOwnerOrGuardian.selector);
        vm.prank(guardian);
        mandate.pause();
        vm.prank(stranger);
        mandate.pause();
    }

    function test_RevertWhen_GuardianIsInvalid() public {
        vm.startPrank(owner);
        vm.expectRevert(Mandate.InvalidAddress.selector);
        mandate.setGuardian(owner);
        vm.expectRevert(Mandate.InvalidAddress.selector);
        mandate.setGuardian(agent);
        vm.stopPrank();
    }

    // ---------------- the agent key ----------------

    function test_ANewAgentKeyWaits() public {
        uint64 expiry = uint64(block.timestamp + 30 days);
        vm.startPrank(owner);
        vm.expectEmit(true, true, true, true);
        emit AgentProposed(attacker, expiry, uint64(block.timestamp) + LOOSEN_DELAY);
        mandate.setAgent(attacker, expiry);
        assertEq(mandate.agent(), agent);
        vm.expectRevert(abi.encodeWithSelector(Mandate.ChangeNotReady.selector, block.timestamp + LOOSEN_DELAY));
        mandate.applyAgent();

        skip(LOOSEN_DELAY);
        mandate.applyAgent();
        vm.stopPrank();
        assertEq(mandate.agent(), attacker);
        assertEq(mandate.agentExpiry(), expiry);
        // the old key is dead
        vm.expectRevert(Mandate.NotAgent.selector);
        _buy(idx, 100 * USD);
    }

    function test_ExtendingTheAgentKeyWaits_ShorteningIsInstant() public {
        vm.startPrank(owner);
        mandate.setAgent(agent, AGENT_EXPIRY + 1);
        assertEq(mandate.agentExpiry(), AGENT_EXPIRY);
        assertEq(mandate.pendingEta(mandate.AGENT_CHANGE()), block.timestamp + LOOSEN_DELAY);

        mandate.setAgent(agent, uint64(START + 1 days));
        vm.stopPrank();
        assertEq(mandate.agentExpiry(), START + 1 days);
        // shortening also drops the extension that was waiting
        assertEq(mandate.pendingEta(mandate.AGENT_CHANGE()), 0);
    }

    function test_GuardianCanVetoANewAgentKey() public {
        bytes32 key = mandate.AGENT_CHANGE();
        vm.prank(owner);
        mandate.setAgent(attacker, uint64(block.timestamp + 30 days));
        vm.prank(guardian);
        mandate.cancelChange(key);
        skip(LOOSEN_DELAY);
        vm.expectRevert(Mandate.NoPendingChange.selector);
        vm.prank(owner);
        mandate.applyAgent();
        assertEq(mandate.agent(), agent);
    }

    function test_RevokingIsInstant_AndDropsAKeyThatWasWaiting() public {
        vm.prank(owner);
        mandate.setAgent(attacker, uint64(block.timestamp + 30 days));
        vm.prank(guardian);
        mandate.revokeAgent();
        assertEq(mandate.agent(), address(0));
        assertEq(mandate.pendingEta(mandate.AGENT_CHANGE()), 0);
        vm.expectRevert(Mandate.NotAgent.selector);
        _buy(idx, 100 * USD);
    }

    function test_RevertWhen_AgentKeyIsInvalid() public {
        vm.startPrank(owner);
        vm.expectRevert(Mandate.ZeroAddress.selector);
        mandate.setAgent(address(0), uint64(block.timestamp + 1 days));
        vm.expectRevert(Mandate.InvalidAddress.selector);
        mandate.setAgent(owner, uint64(block.timestamp + 1 days));
        vm.expectRevert(Mandate.InvalidAddress.selector);
        mandate.setAgent(guardian, uint64(block.timestamp + 1 days));
        vm.expectRevert(Mandate.InvalidAddress.selector);
        mandate.setAgent(address(vault), uint64(block.timestamp + 1 days));
        vm.expectRevert(Mandate.InvalidExpiry.selector);
        mandate.setAgent(attacker, uint64(block.timestamp));
        vm.expectRevert(Mandate.InvalidExpiry.selector);
        mandate.setAgent(attacker, uint64(block.timestamp + 90 days + 1));
        vm.stopPrank();
    }

    // ---------------- the waiting period itself ----------------

    function test_ALongerWaitIsInstant_AShorterOneWaitsOutTheCurrentOne() public {
        vm.startPrank(owner);
        mandate.setLoosenDelay(3 days);
        assertEq(mandate.loosenDelay(), 3 days);

        mandate.setLoosenDelay(1 hours);
        assertEq(mandate.loosenDelay(), 3 days);
        // the shorter wait is itself held for the full three days
        assertEq(mandate.pendingEta(mandate.DELAY_CHANGE()), block.timestamp + 3 days);
        vm.expectRevert(abi.encodeWithSelector(Mandate.ChangeNotReady.selector, block.timestamp + 3 days));
        mandate.applyLoosenDelay();

        skip(3 days);
        mandate.applyLoosenDelay();
        vm.stopPrank();
        assertEq(mandate.loosenDelay(), 1 hours);
    }

    function test_RevertWhen_NewWaitIsOutOfRange() public {
        vm.startPrank(owner);
        vm.expectRevert(Mandate.InvalidDelay.selector);
        mandate.setLoosenDelay(59);
        vm.expectRevert(Mandate.InvalidDelay.selector);
        mandate.setLoosenDelay(30 days + 1);
        vm.stopPrank();
    }

    // ---------------- owner funds ----------------

    function test_WithdrawGoesToTheOwner_EvenWhilePaused() public {
        _buy(idx, 1_000 * USD);
        vm.prank(guardian);
        mandate.pause();

        vm.startPrank(owner);
        vault.withdraw(address(usd), 2_000 * USD);
        vault.withdraw(address(idx), 9.97e18);
        vm.stopPrank();
        assertEq(usd.balanceOf(owner), 2_000 * USD);
        assertEq(idx.balanceOf(owner), 9.97e18);
        assertEq(vault.holdings(address(usd)), 7_000 * USD);
        assertEq(vault.holdings(address(idx)), 0);
    }

    /// A new withdrawal address always waits, whoever asked for it and however urgent it sounds.
    function test_ChangingTheWithdrawalAddressWaits() public {
        address elsewhere = makeAddr("new address");
        vm.startPrank(owner);
        vm.expectEmit(true, true, true, true);
        emit WithdrawalAddressProposed(elsewhere, uint64(block.timestamp) + LOOSEN_DELAY);
        mandate.proposeWithdrawalAddress(elsewhere);
        assertEq(mandate.withdrawalAddress(), owner);

        vm.expectRevert(abi.encodeWithSelector(Mandate.ChangeNotReady.selector, block.timestamp + LOOSEN_DELAY));
        mandate.applyWithdrawalAddress();
        // until then, money still goes to the old address
        vault.withdraw(address(usd), 100 * USD);
        assertEq(usd.balanceOf(owner), 100 * USD);
        assertEq(usd.balanceOf(elsewhere), 0);

        skip(LOOSEN_DELAY);
        mandate.applyWithdrawalAddress();
        vault.withdraw(address(usd), 100 * USD);
        vm.stopPrank();
        assertEq(mandate.withdrawalAddress(), elsewhere);
        assertEq(usd.balanceOf(elsewhere), 100 * USD);
    }

    function test_GuardianCanVetoAWithdrawalAddressChange() public {
        bytes32 key = mandate.WITHDRAWAL_CHANGE();
        vm.prank(owner);
        mandate.proposeWithdrawalAddress(attacker);
        vm.prank(guardian);
        mandate.cancelChange(key);

        skip(LOOSEN_DELAY);
        vm.expectRevert(Mandate.NoPendingChange.selector);
        vm.prank(owner);
        mandate.applyWithdrawalAddress();
        assertEq(mandate.withdrawalAddress(), owner);
    }

    function test_RevertWhen_WithdrawalAddressIsInvalid() public {
        vm.startPrank(owner);
        vm.expectRevert(PolicyVault.ZeroAddress.selector);
        mandate.proposeWithdrawalAddress(address(0));
        vm.expectRevert(Mandate.InvalidAddress.selector);
        mandate.proposeWithdrawalAddress(agent);
        vm.expectRevert(Mandate.InvalidAddress.selector);
        mandate.proposeWithdrawalAddress(address(vault));
        vm.stopPrank();
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

    // ---------------- leaving ----------------

    /// The mandate never holds the owner's money back. Taking out everything ends it.
    function test_AFullWithdrawalEndsTheMandate() public {
        _buy(idx, 1_000 * USD);
        vm.startPrank(owner);
        vault.withdraw(address(usd), 9_000 * USD);
        assertEq(mandate.agent(), agent);

        vm.expectEmit(true, true, true, true);
        emit Terminated();
        vault.withdraw(address(idx), 9.97e18);
        vm.stopPrank();
        assertEq(mandate.agent(), address(0));
        assertEq(usd.balanceOf(owner), 9_000 * USD);
        assertEq(idx.balanceOf(owner), 9.97e18);
    }

    /// Coming back to the same vault needs a new agent key, and a new key waits.
    function test_AfterTerminationTheAgentComesBackOnlyAfterTheWait() public {
        vm.startPrank(owner);
        vault.withdraw(address(usd), FUNDS);
        vault.deposit(address(usd), FUNDS);
        mandate.setAgent(agent, AGENT_EXPIRY);
        vm.stopPrank();
        assertEq(mandate.agent(), address(0));

        vm.expectRevert(Mandate.NotAgent.selector);
        _buy(idx, 100 * USD);

        skip(LOOSEN_DELAY);
        _refreshPrices();
        vm.prank(owner);
        mandate.applyAgent();
        _buy(idx, 100 * USD);
    }

    // ---------------- approvals for one exact trade ----------------

    function _use(PolicyVault.TradeApproval memory a, bytes memory sig) internal returns (uint256) {
        vm.prank(agent);
        return vault.tradeWithApproval(a, sig, REF);
    }

    function test_OwnerSignsForATradeAboveTheAgentLimits() public {
        (PolicyVault.TradeApproval memory a, bytes memory sig) = _approval(true, bond, 2_500 * USD, 7, 1 hours, OWNER_KEY);
        vm.expectEmit(true, true, true, true);
        emit ApprovalUsed(7, 0, address(usd), address(bond), 2_500 * USD);
        _use(a, sig);

        assertEq(vault.holdings(address(bond)), 24.925e18);
        assertTrue(vault.usedNonce(7));
        // it does not use the agent's own allowance
        assertEq(vault.dailyVolumeRemaining(), MAX_DAILY);
    }

    function test_OwnerSignsForALargeSell() public {
        _holdIndex();
        (PolicyVault.TradeApproval memory a, bytes memory sig) = _approval(false, idx, 39.88e18, 1, 1 hours, OWNER_KEY);
        _use(a, sig);
        assertEq(vault.holdings(address(idx)), 0);
    }

    function test_RevertWhen_ApprovalIsUsedTwice() public {
        (PolicyVault.TradeApproval memory a, bytes memory sig) = _approval(true, bond, 500 * USD, 7, 1 hours, OWNER_KEY);
        _use(a, sig);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ApprovalAlreadyUsed.selector, 7));
        _use(a, sig);
    }

    /// The signature covers every field. Change any of them and it is no longer the owner's.
    function test_RevertWhen_AnyApprovedFieldIsChanged() public {
        (PolicyVault.TradeApproval memory a, bytes memory sig) = _approval(true, bond, 500 * USD, 7, 30 minutes, OWNER_KEY);
        PolicyVault.TradeApproval memory b = _copy(a);

        b.amount = 501 * USD;
        vm.expectRevert(PolicyVault.BadApproval.selector);
        _use(b, sig);
        b = _copy(a);
        b.assetOut = address(idx);
        vm.expectRevert(PolicyVault.BadApproval.selector);
        _use(b, sig);
        b = _copy(a);
        b.nonce = 8;
        vm.expectRevert(PolicyVault.BadApproval.selector);
        _use(b, sig);
        b = _copy(a);
        b.expiry += 1;
        vm.expectRevert(PolicyVault.BadApproval.selector);
        _use(b, sig);
        b = _copy(a);
        b.action = 1;
        vm.expectRevert(PolicyVault.BadApproval.selector);
        _use(b, sig);

        // untouched, it still works
        _use(a, sig);
    }

    function _copy(PolicyVault.TradeApproval memory a) internal pure returns (PolicyVault.TradeApproval memory) {
        return PolicyVault.TradeApproval(a.action, a.assetIn, a.assetOut, a.amount, a.nonce, a.validFrom, a.expiry);
    }

    function test_RevertWhen_ApprovalIsNotSignedByTheOwner() public {
        (PolicyVault.TradeApproval memory a, bytes memory sig) = _approval(true, bond, 500 * USD, 7, 1 hours, 0xBAD);
        vm.expectRevert(PolicyVault.BadApproval.selector);
        _use(a, sig);
        // nor does a malformed signature get through
        vm.expectRevert(PolicyVault.BadApproval.selector);
        _use(a, hex"1234");
    }

    function test_RevertWhen_ApprovalHasExpiredOrIsNotValidYet() public {
        (PolicyVault.TradeApproval memory a, bytes memory sig) = _approval(true, bond, 500 * USD, 7, 10 minutes, OWNER_KEY);
        skip(10 minutes + 1);
        _refreshPrices();
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ApprovalNotValidNow.selector, a.validFrom, a.expiry));
        _use(a, sig);

        a.validFrom = uint64(block.timestamp + 5 minutes);
        a.expiry = uint64(block.timestamp + 15 minutes);
        sig = _sign(a, OWNER_KEY);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ApprovalNotValidNow.selector, a.validFrom, a.expiry));
        _use(a, sig);
    }

    /// An approval is good for an hour at most, so a signature cannot sit around for days.
    function test_RevertWhen_ApprovalLivesLongerThanAnHour() public {
        (PolicyVault.TradeApproval memory a, bytes memory sig) = _approval(true, bond, 500 * USD, 7, 1 hours + 1, OWNER_KEY);
        vm.expectRevert(PolicyVault.ApprovalTooLong.selector);
        _use(a, sig);
    }

    function test_OwnerCanCancelAnApprovalBeforeItIsUsed() public {
        (PolicyVault.TradeApproval memory a, bytes memory sig) = _approval(true, bond, 500 * USD, 7, 1 hours, OWNER_KEY);
        vm.prank(owner);
        vault.cancelApproval(7);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ApprovalAlreadyUsed.selector, 7));
        _use(a, sig);
    }

    function test_RevertWhen_SomeoneElseSubmitsTheApproval() public {
        (PolicyVault.TradeApproval memory a, bytes memory sig) = _approval(true, bond, 500 * USD, 7, 1 hours, OWNER_KEY);
        vm.expectRevert(Mandate.NotAgent.selector);
        vm.prank(attacker);
        vault.tradeWithApproval(a, sig, REF);

        vm.prank(guardian);
        mandate.pause();
        vm.expectRevert(Mandate.AgentPaused.selector);
        _use(a, sig);
    }

    function test_RevertWhen_ApprovalIsForAnotherVault() public {
        vm.startPrank(stranger);
        (, PolicyVault other) = factory.createVault(address(0), LOOSEN_DELAY);
        vm.stopPrank();
        (PolicyVault.TradeApproval memory a,) = _approval(true, bond, 500 * USD, 7, 1 hours, OWNER_KEY);
        // signed by the right owner, but for the other vault's address
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, other.approvalDigest(a));
        vm.expectRevert(PolicyVault.BadApproval.selector);
        _use(a, abi.encodePacked(r, s, v));
    }

    function test_RevertWhen_ApprovalDoesNotTradeAgainstCash() public {
        PolicyVault.TradeApproval memory a = PolicyVault.TradeApproval({
            action: 0,
            assetIn: address(idx),
            assetOut: address(bond),
            amount: 500 * USD,
            nonce: 7,
            validFrom: uint64(block.timestamp),
            expiry: uint64(block.timestamp + 1 hours)
        });
        bytes memory sig = _sign(a, OWNER_KEY);
        vm.expectRevert(PolicyVault.BadApproval.selector);
        _use(a, sig);
        assertFalse(vault.usedNonce(7));
    }

    /// The approval lifts the two size limits and nothing else. Each rule below still refuses the trade.
    function test_RevertWhen_ApprovedTradeBreaksAnyOtherRule() public {
        // not in the mandate
        (PolicyVault.TradeApproval memory a, bytes memory sig) = _approval(true, meme, 100 * USD, 1, 1 hours, OWNER_KEY);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.AssetNotAllowed.selector, address(meme)));
        _use(a, sig);

        // over the asset's cap
        (a, sig) = _approval(true, gold, 5_000 * USD, 2, 1 hours, OWNER_KEY);
        vm.expectPartialRevert(PolicyVault.ExceedsExposure.selector);
        _use(a, sig);

        // under the defensive floor
        Policy memory p = _policy();
        p.minDefensiveBps = 7000;
        vm.prank(owner);
        mandate.proposePolicy(p);
        (a, sig) = _approval(true, idx, 4_000 * USD, 3, 1 hours, OWNER_KEY);
        vm.expectPartialRevert(PolicyVault.BelowDefensiveFloor.selector);
        _use(a, sig);
        // a failed attempt does not burn the approval
        assertFalse(vault.usedNonce(3));
    }

    function test_RevertWhen_ApprovedBuyIsInProtectModeOrCooldown() public {
        _holdIndex();
        _crashIndex();
        (PolicyVault.TradeApproval memory a, bytes memory sig) = _approval(true, bond, 100 * USD, 1, 1 hours, OWNER_KEY);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.ExceedsDailyLoss.selector, 1084, DAILY_LOSS_BPS));
        _use(a, sig);

        vault.poke();
        _setPrice(idx, 8_019_000_000);
        _setPrice(idx, 8_820_900_000);
        _setPrice(idx, 9_702_990_000);
        vm.expectRevert(abi.encodeWithSelector(PolicyVault.CooldownActive.selector, vault.cooldownUntil()));
        _use(a, sig);
    }

    function test_RevertWhen_ApprovedBuyIsAtOrBelowTheStopPrice() public {
        _setStop(100 * PRICE);
        (PolicyVault.TradeApproval memory a, bytes memory sig) = _approval(true, idx, 100 * USD, 1, 1 hours, OWNER_KEY);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyVault.BelowStopPrice.selector, address(idx), 100 * PRICE, 100 * PRICE)
        );
        _use(a, sig);
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
        mandate.pause();
        (uint256 tradable, uint256 maxCost) = vault.agentExposure();
        assertEq(tradable + maxCost, 0);

        vm.revertToState(snap);
        vm.prank(guardian);
        mandate.revokeAgent();
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

    /// Whatever the agent buys, the trade is inside the size limit, the asset is on the
    /// allowlist and inside its cap, and enough is left in defensive assets.
    function testFuzz_BuyStaysInsideTheMandate(uint256 seed, uint256 usdIn, uint8 rounds) public {
        rounds = uint8(bound(rounds, 1, 6));
        for (uint256 i = 0; i < rounds; i++) {
            MockAsset asset = _pick(uint256(keccak256(abi.encode(seed, i))));
            uint256 amount = bound(uint256(keccak256(abi.encode(usdIn, i))), 0, 2_200 * USD);
            uint256 limit = vault.portfolioValue() * MAX_TRADE_BPS / 10_000;
            vm.prank(agent);
            try vault.buy(address(asset), amount, REF) {
                assertTrue(mandate.getRule(address(asset)).allowed);
                assertLe(vault.exposureBps(address(asset)), mandate.getRule(address(asset)).maxExposureBps);
                assertGe(vault.defensiveBps(), MIN_DEFENSIVE_BPS);
                assertLe(amount, limit);
            } catch {}
        }
        assertEq(vault.holdings(address(meme)), 0);
        assertEq(meme.balanceOf(address(vault)), 0);
    }

    /// A trade never costs more against the oracle price than the slippage limit allows.
    function testFuzz_TradeCostIsBounded(uint256 usdIn, uint256 sellShare) public {
        usdIn = bound(usdIn, 1, 1_000 * USD);
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
                try vault.buy(address(asset), bound(r >> 16, 0, 1_000 * USD), REF) {
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

    /// Any mandate the owner proposes either tightens every field and applies now, or changes nothing yet.
    function testFuzz_PolicyChangeIsTighterOrQueued(uint16[5] memory bps, uint8 streak, uint32 cooldown) public {
        Policy memory p = Policy({
            maxTradeBps: uint16(bound(bps[0], 0, 10_000)),
            maxDailyVolumeBps: bps[1],
            dailyLossBps: uint16(bound(bps[2], 0, 10_000)),
            maxSlippageBps: uint16(bound(bps[3], 0, 500)),
            minDefensiveBps: uint16(bound(bps[4], 0, 10_000)),
            maxLossStreak: streak,
            cooldown: uint32(bound(cooldown, 0, 30 days))
        });
        Policy memory old = _policy();
        vm.prank(owner);
        mandate.proposePolicy(p);

        Policy memory cur = mandate.getPolicy();
        uint64 eta = mandate.pendingEta(mandate.POLICY_CHANGE());
        if (keccak256(abi.encode(cur)) == keccak256(abi.encode(old))) {
            bool unchanged = keccak256(abi.encode(p)) == keccak256(abi.encode(old));
            assertTrue(unchanged || eta == block.timestamp + LOOSEN_DELAY);
        } else {
            assertEq(keccak256(abi.encode(cur)), keccak256(abi.encode(p)));
            assertLe(cur.maxTradeBps, old.maxTradeBps);
            assertLe(cur.maxDailyVolumeBps, old.maxDailyVolumeBps);
            assertLe(cur.dailyLossBps, old.dailyLossBps);
            assertLe(cur.maxSlippageBps, old.maxSlippageBps);
            assertGe(cur.minDefensiveBps, old.minDefensiveBps);
            assertTrue(cur.maxLossStreak != 0 && cur.maxLossStreak <= old.maxLossStreak);
            assertGe(cur.cooldown, old.cooldown);
            assertEq(eta, 0);
        }
    }
}
