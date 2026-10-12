// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {MockAsset} from "../src/mocks/MockAsset.sol";
import {PriceOracle} from "../src/mocks/PriceOracle.sol";
import {VaultFixture} from "./utils/VaultFixture.sol";

/// Plays a fully compromised agent: it holds the real agent key and fires
/// random calls at everything that key can reach. After every call that goes
/// through, it checks the result against the policy and records any breach.
contract CompromisedAgent is Test {
    PolicyVault public vault;
    TestUSD public usd;
    PriceOracle public oracle;
    address public agent;
    address public attacker;
    address[] public tokens; // three allowlisted assets, then the one that is not

    bool public tradedOffAllowlist;
    bool public exposureBroken;
    bool public boughtWhileProtected;
    bool public boughtBelowStop;
    bool public tradedWhilePaused;
    bool public sizeBroken;
    bool public volumeBroken;
    bool public costBroken;
    bool public stopFiredEarly;
    bool public policyTouched;

    uint256 public attempts;
    uint256 public trades;
    uint256 public buysRefusedInProtectMode;
    uint256 public stopLossesFired;
    /// how often each contract error turned the agent away
    mapping(bytes4 => uint256) public refusals;
    mapping(uint256 => uint256) public volumeByDay;

    constructor(
        PolicyVault vault_,
        TestUSD usd_,
        PriceOracle oracle_,
        address agent_,
        address attacker_,
        address[] memory tokens_
    ) {
        vault = vault_;
        usd = usd_;
        oracle = oracle_;
        agent = agent_;
        attacker = attacker_;
        tokens = tokens_;
    }

    /// Random size, from nothing up to twice the per-trade limit.
    function buy(uint256 assetSeed, uint256 amount) external {
        _tryBuy(tokens[assetSeed % tokens.length], bound(amount, 0, 2 * vault.getPolicy().maxTradeUsd + 1));
    }

    function sell(uint256 assetSeed, uint256 amount) external {
        address asset = tokens[assetSeed % tokens.length];
        (uint256 price,) = oracle.getPrice(asset);
        uint256 twiceTheLimit = 2 * vault.getPolicy().maxTradeUsd * 1e20 / price;
        uint256 held = vault.holdings(asset) + 1e18;
        _trySell(asset, bound(amount, 0, held < twiceTheLimit ? held : twiceTheLimit));
    }

    /// Far outside every limit.
    function buyHuge(uint256 assetSeed, uint256 amount) external {
        _tryBuy(tokens[assetSeed % tokens.length], bound(amount, 0, type(uint128).max));
    }

    /// The smartest attack available: for each asset take exactly as much as
    /// the limits allow, try for one more unit, then go for the token that is
    /// off the allowlist.
    function drain(uint256 seed) external {
        for (uint256 i = 0; i < 3; i++) {
            address asset = tokens[(seed % 3 + i) % 3];
            uint256 amount = vault.getPolicy().maxTradeUsd;
            uint256 left = vault.dailyVolumeRemaining();
            if (left < amount) amount = left;
            uint256 cash = vault.holdings(address(usd));
            if (cash < amount) amount = cash;
            _tryBuy(asset, amount);
            _tryBuy(asset, 1);
        }
        _tryBuy(tokens[3], 1e6);
    }

    /// Dump everything it is allowed to dump.
    function dump(uint256 seed) external {
        for (uint256 i = 0; i < 3; i++) {
            address asset = tokens[(seed % 3 + i) % 3];
            _trySell(asset, vault.holdings(asset));
        }
    }

    function rebalance(uint256 seed, uint8 legs) external {
        legs = uint8(bound(legs, 1, 4));
        PolicyVault.Order[] memory orders = new PolicyVault.Order[](legs);
        PolicyVault.Policy memory p = vault.getPolicy();
        uint256 volume;
        bool hasBuy;
        bool legTooBig;
        for (uint256 i = 0; i < legs; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            address asset = tokens[r % tokens.length];
            bool isBuy = (r >> 8) % 2 == 0;
            uint256 amount = isBuy ? bound(r >> 16, 0, 3_000e6) : bound(r >> 16, 0, vault.holdings(asset));
            orders[i] = PolicyVault.Order(asset, isBuy, amount);
            uint256 value = isBuy ? amount : _usdValue(asset, amount);
            volume += value;
            if (value > p.maxTradeUsd) legTooBig = true;
            if (isBuy) hasBuy = true;
        }
        bool wasProtected = vault.inProtectMode();
        bool wasPaused = vault.paused();
        uint256 valueBefore = vault.portfolioValue();
        attempts++;
        vm.prank(agent);
        try vault.rebalance(orders, bytes32(0)) {
            if (hasBuy && wasProtected) boughtWhileProtected = true;
            if (legTooBig) sizeBroken = true;
            for (uint256 i = 0; i < legs; i++) {
                if (orders[i].isBuy) _checkHolding(orders[i].asset);
            }
            _afterTrade(volume, valueBefore, wasPaused);
        } catch {}
    }

    /// Ask for a trade above the limits, then try to approve it with the agent key.
    function requestAndSelfApprove(uint256 assetSeed, bool isBuy, uint256 amount) external {
        address asset = tokens[assetSeed % tokens.length];
        bytes32 before = _policyHash();
        vm.startPrank(agent);
        try vault.requestTrade(asset, isBuy, bound(amount, 0, 1_000_000e6), bytes32(0)) returns (uint256 id) {
            try vault.approveRequest(id) {
                policyTouched = true;
            } catch {}
        } catch {}
        vm.stopPrank();
        if (_policyHash() != before) policyTouched = true;
    }

    function callOwnerFunctions(uint256 amount, uint256 assetSeed) external {
        address asset = tokens[assetSeed % tokens.length];
        PolicyVault.Policy memory loose = PolicyVault.Policy(type(uint256).max, type(uint256).max, 10_000, 500, 0);
        PolicyVault.AssetRule memory open = PolicyVault.AssetRule(true, 10_000, 0);
        address[] memory assets = new address[](1);
        assets[0] = asset;
        PolicyVault.AssetRule[] memory rules = new PolicyVault.AssetRule[](1);
        rules[0] = open;

        bytes32 before = _policyHash();
        uint256 usdBefore = usd.balanceOf(address(vault));
        vm.startPrank(agent);
        try vault.withdraw(address(usd), amount) {} catch {}
        try vault.withdraw(asset, amount) {} catch {}
        try vault.sweep(address(usd)) {} catch {}
        try vault.deposit(address(usd), amount) {} catch {}
        try vault.initialize(loose, assets, rules) {} catch {}
        try vault.proposePolicy(loose) {} catch {}
        try vault.applyPolicy() {} catch {}
        try vault.proposeAssetRule(asset, open) {} catch {}
        try vault.applyAssetRule(asset) {} catch {}
        try vault.approveRequest(vault.requestCount()) {} catch {}
        try vault.setAgent(attacker, uint64(block.timestamp + 90 days)) {} catch {}
        try vault.setGuardian(agent) {} catch {}
        try vault.transferGuardian(agent) {} catch {}
        try vault.cancelPolicy() {} catch {}
        try vault.cancelAssetRule(asset) {} catch {}
        try vault.pause() {} catch {}
        try vault.unpause() {} catch {}
        // and straight at the tokens
        try usd.transferFrom(address(vault), agent, amount) {} catch {}
        try IERC20(asset).transferFrom(address(vault), agent, amount) {} catch {}
        vm.stopPrank();
        if (_policyHash() != before || usd.balanceOf(address(vault)) != usdBefore) policyTouched = true;
    }

    /// Anyone can call the stop-loss. It must only fire at or below the stop price.
    function triggerStopLoss(uint256 assetSeed) external {
        address asset = tokens[assetSeed % tokens.length];
        (uint256 price,) = oracle.getPrice(asset);
        uint256 stopPrice = vault.getRule(asset).stopPrice;
        bool wasPaused = vault.paused();
        vm.prank(attacker);
        try vault.triggerStopLoss(asset) {
            stopLossesFired++;
            if (price > stopPrice || wasPaused || vault.holdings(asset) != 0) stopFiredEarly = true;
        } catch {}
    }

    function poke() external {
        vm.prank(attacker);
        try vault.poke() {} catch {}
    }

    /// Free test dollars sent straight to the vault must not shift any check.
    function donate(uint256 amount) external {
        uint256 valueBefore = vault.portfolioValue();
        usd.mint(address(vault), bound(amount, 1, 1_000_000e6));
        if (vault.portfolioValue() != valueBefore) policyTouched = true;
    }

    function _tryBuy(address asset, uint256 amount) internal {
        (uint256 price,) = oracle.getPrice(asset);
        bool belowStop = price <= vault.getRule(asset).stopPrice;
        bool wasProtected = vault.inProtectMode();
        bool wasPaused = vault.paused();
        uint256 valueBefore = vault.portfolioValue();
        attempts++;
        vm.prank(agent);
        try vault.buy(asset, amount, bytes32(0)) {
            if (wasProtected) boughtWhileProtected = true;
            if (belowStop) boughtBelowStop = true;
            if (amount > vault.getPolicy().maxTradeUsd) sizeBroken = true;
            _checkHolding(asset);
            _afterTrade(amount, valueBefore, wasPaused);
        } catch (bytes memory err) {
            refusals[bytes4(err)]++;
            if (wasProtected) buysRefusedInProtectMode++;
        }
    }

    function _trySell(address asset, uint256 amount) internal {
        bool wasPaused = vault.paused();
        uint256 valueBefore = vault.portfolioValue();
        uint256 value = _usdValue(asset, amount);
        attempts++;
        vm.prank(agent);
        try vault.sell(asset, amount, bytes32(0)) {
            if (value > vault.getPolicy().maxTradeUsd) sizeBroken = true;
            _afterTrade(value, valueBefore, wasPaused);
        } catch (bytes memory err) {
            refusals[bytes4(err)]++;
        }
    }

    function _checkHolding(address asset) internal {
        PolicyVault.AssetRule memory rule = vault.getRule(asset);
        if (!rule.allowed) tradedOffAllowlist = true;
        if (vault.exposureBps(asset) > rule.maxExposureBps) exposureBroken = true;
    }

    function _afterTrade(uint256 usdValue, uint256 valueBefore, bool wasPaused) internal {
        trades++;
        PolicyVault.Policy memory p = vault.getPolicy();
        if (wasPaused) tradedWhilePaused = true;
        uint256 today = block.timestamp / 1 days;
        volumeByDay[today] += usdValue;
        if (volumeByDay[today] > p.maxDailyVolumeUsd) volumeBroken = true;
        uint256 valueAfter = vault.portfolioValue();
        // prices did not move inside this call, so any drop in value is what the trade cost
        if (valueBefore > valueAfter && valueBefore - valueAfter > usdValue * p.maxSlippageBps / 10_000 + 4) {
            costBroken = true;
        }
    }

    function _usdValue(address asset, uint256 amount) internal view returns (uint256) {
        (uint256 price,) = oracle.getPrice(asset);
        return amount * price / 1e20;
    }

    function _policyHash() internal view returns (bytes32 h) {
        h = keccak256(
            abi.encode(
                vault.getPolicy(),
                vault.getPendingPolicy(),
                vault.agent(),
                vault.agentExpiry(),
                vault.guardian(),
                vault.paused(),
                vault.getAssets()
            )
        );
        for (uint256 i = 0; i < tokens.length; i++) {
            h = keccak256(abi.encode(h, vault.getRule(tokens[i]), vault.getPendingRule(tokens[i])));
        }
    }
}

/// Plays the human side: an owner who keeps changing their mind, mostly towards
/// looser rules, and a guardian who sometimes says no. It records any change
/// that got looser without waiting out the delay.
contract PanickingOwner is Test {
    PolicyVault public vault;
    TestUSD public usd;
    PriceOracle public oracle;
    address public owner;
    address public guardian;
    address[] public tokens;

    bool public loosenedInstantly;
    bool public appliedEarly;
    bool public approvedTradeBrokeARule;

    uint256 public queued;
    uint256 public applied;
    uint256 public vetoed;

    constructor(
        PolicyVault vault_,
        TestUSD usd_,
        PriceOracle oracle_,
        address owner_,
        address guardian_,
        address[] memory tokens_
    ) {
        vault = vault_;
        usd = usd_;
        oracle = oracle_;
        owner = owner_;
        guardian = guardian_;
        tokens = tokens_;
    }

    function loosenPolicy(uint256 seed) external {
        seed = uint256(keccak256(abi.encode(seed)));
        PolicyVault.Policy memory p = vault.getPolicy();
        uint256 field = seed % 5;
        uint256 r = seed >> 8;
        if (field == 0) p.maxTradeUsd = bound(r, p.maxTradeUsd, 20_000e6);
        else if (field == 1) p.maxDailyVolumeUsd = bound(r, p.maxDailyVolumeUsd, 50_000e6);
        else if (field == 2) p.dailyLossBps = uint16(bound(r, p.dailyLossBps, 10_000));
        else if (field == 3) p.maxSlippageBps = uint16(bound(r, p.maxSlippageBps, 500));
        else p.cooldown = uint32(bound(r, 0, p.cooldown));
        _propose(p);
    }

    function tightenPolicy(uint256 seed) external {
        seed = uint256(keccak256(abi.encode(seed)));
        PolicyVault.Policy memory p = vault.getPolicy();
        uint256 field = seed % 5;
        uint256 r = seed >> 8;
        // floors keep the agent able to act, so the run keeps testing something
        if (field == 0 && p.maxTradeUsd > 200e6) p.maxTradeUsd = bound(r, 200e6, p.maxTradeUsd);
        else if (field == 1 && p.maxDailyVolumeUsd > 1_000e6) p.maxDailyVolumeUsd = bound(r, 1_000e6, p.maxDailyVolumeUsd);
        else if (field == 2 && p.dailyLossBps > 200) p.dailyLossBps = uint16(bound(r, 200, p.dailyLossBps));
        else if (field == 3 && p.maxSlippageBps > 50) p.maxSlippageBps = uint16(bound(r, 50, p.maxSlippageBps));
        else if (p.cooldown < 3 days) p.cooldown = uint32(bound(r, p.cooldown, 3 days));
        _propose(p);
    }

    function applyPolicy(bool waitFirst) external {
        uint64 eta = vault.getPendingPolicy().eta;
        if (waitFirst && eta > block.timestamp) vm.warp(eta);
        vm.prank(owner);
        try vault.applyPolicy() {
            applied++;
            if (eta == 0 || block.timestamp < eta) appliedEarly = true;
        } catch {}
    }

    function changeRule(uint256 assetSeed, uint256 seed) external {
        address asset = tokens[assetSeed % 3];
        seed = uint256(keccak256(abi.encode(seed)));
        PolicyVault.AssetRule memory old = vault.getRule(asset);
        PolicyVault.AssetRule memory rule = old;
        (uint256 price,) = oracle.getPrice(asset);
        uint256 r = seed >> 8;
        if (seed % 4 == 0) rule.maxExposureBps = uint16(bound(r, old.maxExposureBps, 10_000));
        else if (seed % 4 == 1) rule.maxExposureBps = uint16(bound(r, 1_000, 10_000));
        else if (seed % 4 == 2) rule.stopPrice = bound(r, 0, price);
        else rule.stopPrice = bound(r, old.stopPrice, old.stopPrice > price ? old.stopPrice : price);

        vm.prank(owner);
        try vault.proposeAssetRule(asset, rule) {} catch {
            return;
        }
        PolicyVault.AssetRule memory cur = vault.getRule(asset);
        bool tighterOrSame = (!cur.allowed || old.allowed) && cur.maxExposureBps <= old.maxExposureBps
            && cur.stopPrice >= old.stopPrice;
        if (!tighterOrSame) loosenedInstantly = true;
        if (vault.getPendingRule(asset).eta != 0) queued++;
    }

    function applyRule(uint256 assetSeed, bool waitFirst) external {
        address asset = tokens[assetSeed % 3];
        uint64 eta = vault.getPendingRule(asset).eta;
        if (waitFirst && eta > block.timestamp) vm.warp(eta);
        vm.prank(owner);
        try vault.applyAssetRule(asset) {
            applied++;
            if (eta == 0 || block.timestamp < eta) appliedEarly = true;
        } catch {}
    }

    /// A panicking owner tries to let the agent buy the token that is pumping.
    function tryToAllowTheMemeCoin() external {
        vm.prank(owner);
        try vault.proposeAssetRule(tokens[3], PolicyVault.AssetRule(true, 10_000, 0)) {} catch {}
        if (vault.getRule(tokens[3]).allowed) loosenedInstantly = true;
        // the guardian always vetoes this one, so the token stays off the allowlist for the whole run
        vm.prank(guardian);
        try vault.cancelAssetRule(tokens[3]) {
            vetoed++;
        } catch {}
    }

    /// Takes an asset off the allowlist (instant) or asks to put it back (waits).
    function delistOrRelist(uint256 assetSeed) external {
        address asset = tokens[assetSeed % 3];
        PolicyVault.AssetRule memory old = vault.getRule(asset);
        PolicyVault.AssetRule memory rule = old;
        rule.allowed = !old.allowed;
        vm.prank(owner);
        vault.proposeAssetRule(asset, rule);
        if (vault.getRule(asset).allowed && !old.allowed) loosenedInstantly = true;
        if (vault.getPendingRule(asset).eta != 0) queued++;
    }

    function guardianVetoes() external {
        vm.prank(guardian);
        try vault.cancelPolicy() {
            vetoed++;
        } catch {}
    }

    /// Mostly unpauses, so the run spends most of its time with a live agent.
    function pauseOrUnpause(uint256 seed) external {
        // hashed because the fuzzer favours round numbers
        if (uint256(keccak256(abi.encode(seed))) % 6 == 0) {
            vm.prank(guardian);
            vault.pause();
        } else {
            vm.prank(owner);
            vault.unpause();
        }
    }

    function approveLatestRequest() external {
        uint256 id = vault.requestCount();
        if (id == 0) return;
        PolicyVault.Request memory req = vault.getRequest(id);
        bool wasProtected = vault.inProtectMode();
        bool wasPaused = vault.paused();
        vm.prank(owner);
        try vault.approveRequest(id) {
            if (wasPaused) approvedTradeBrokeARule = true;
            if (req.isBuy) {
                PolicyVault.AssetRule memory rule = vault.getRule(req.asset);
                if (wasProtected || !rule.allowed || vault.exposureBps(req.asset) > rule.maxExposureBps) {
                    approvedTradeBrokeARule = true;
                }
            }
        } catch {}
    }

    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 5_000e6);
        usd.mint(owner, amount);
        vm.startPrank(owner);
        usd.approve(address(vault), amount);
        vault.deposit(address(usd), amount);
        vm.stopPrank();
    }

    function withdraw(uint256 tokenSeed, uint256 amount) external {
        address token = tokenSeed % 4 == 3 ? address(usd) : tokens[tokenSeed % 3];
        uint256 held = vault.holdings(token);
        if (held == 0) return;
        vm.prank(owner);
        vault.withdraw(token, bound(amount, 1, held / 4 + 1));
    }

    function _propose(PolicyVault.Policy memory p) internal {
        PolicyVault.Policy memory old = vault.getPolicy();
        vm.prank(owner);
        try vault.proposePolicy(p) {} catch {
            return;
        }
        PolicyVault.Policy memory cur = vault.getPolicy();
        bool tighterOrSame = cur.maxTradeUsd <= old.maxTradeUsd && cur.maxDailyVolumeUsd <= old.maxDailyVolumeUsd
            && cur.dailyLossBps <= old.dailyLossBps && cur.maxSlippageBps <= old.maxSlippageBps
            && cur.cooldown >= old.cooldown;
        if (!tighterOrSame) loosenedInstantly = true;
        if (vault.getPendingPolicy().eta != 0) queued++;
    }
}

/// Moves time and prices, inside what the oracle allows.
contract MarketMoves is Test {
    PriceOracle public oracle;
    address public updater;
    address[] public tokens;
    uint64 public interval;

    constructor(PriceOracle oracle_, address updater_, address[] memory tokens_, uint64 interval_) {
        oracle = oracle_;
        updater = updater_;
        tokens = tokens_;
        interval = interval_;
    }

    /// Time passes and the price keeper keeps every feed fresh.
    function wait(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, interval, 10 hours));
        vm.startPrank(updater);
        for (uint256 i = 0; i < tokens.length; i++) {
            (uint256 p,) = oracle.getPrice(tokens[i]);
            oracle.setPrice(tokens[i], p);
        }
        vm.stopPrank();
    }

    /// Time passes and nobody updates the prices. One time in four it is long enough for them to go stale.
    function waitWithStalePrices(uint256 secs) external {
        bool long = uint256(keccak256(abi.encode(secs))) % 4 == 0;
        vm.warp(block.timestamp + (long ? bound(secs, 1 hours, 3 hours) : bound(secs, 0, 10 minutes)));
    }

    function movePrice(uint256 assetSeed, uint256 target) external {
        _move(tokens[assetSeed % tokens.length], target, false);
    }

    function crash(uint256 assetSeed) external {
        _move(tokens[assetSeed % tokens.length], 0, true);
    }

    function _move(address asset, uint256 target, bool toFloor) internal {
        vm.warp(block.timestamp + interval);
        (uint256 lowest, uint256 highest) = oracle.allowedRange(asset);
        // keep prices in a sane band so the run does not drift to dust
        if (lowest < 1e4) lowest = 1e4;
        if (highest > 1e14) highest = 1e14;
        vm.prank(updater);
        try oracle.setPrice(asset, toFloor ? lowest : bound(target, lowest, highest)) {} catch {}
    }
}

abstract contract InvariantFixture is VaultFixture {
    CompromisedAgent agentHandler;
    PanickingOwner ownerHandler;
    MarketMoves market;
    address[] tokens;

    function setUp() public virtual override {
        super.setUp();
        tokens = [address(idx), address(bond), address(gold), address(meme)];

        // start with a real portfolio and a stop price, so there is something to lose
        _holdIndex();
        _buy(bond, 1_000 * USD);
        _buy(gold, 500 * USD);
        // a long cooldown, so runs spend real time in the state where the loss
        // has recovered or a new day has begun but buying must still be refused
        PolicyVault.Policy memory p = _policy();
        p.cooldown = 2 days;
        vm.startPrank(owner);
        vault.proposePolicy(p);
        vault.proposeAssetRule(address(idx), PolicyVault.AssetRule(true, 5000, 85 * PRICE));
        vm.stopPrank();

        agentHandler = new CompromisedAgent(vault, usd, oracle, agent, attacker, tokens);
        ownerHandler = new PanickingOwner(vault, usd, oracle, owner, guardian, tokens);
        market = new MarketMoves(oracle, updater, tokens, ORACLE_INTERVAL);
        targetContract(address(agentHandler));
        targetContract(address(market));
    }
}

/// A compromised agent, a panicking owner and a moving market, all at once.
contract PolicyVaultInvariantTest is InvariantFixture {
    function setUp() public override {
        super.setUp();
        targetContract(address(ownerHandler));
    }

    /// Nothing ever reaches the agent, the caller of a stop-loss, or anyone else.
    /// Every test dollar is in the vault, with the exchange, or with the owner.
    function invariant_FundsOnlyLeaveToTheOwner() public view {
        assertEq(
            usd.totalSupply(), usd.balanceOf(address(vault)) + usd.balanceOf(address(exchange)) + usd.balanceOf(owner)
        );
        for (uint256 i = 0; i < 3; i++) {
            MockAsset a = MockAsset(tokens[i]);
            assertEq(a.totalSupply(), a.balanceOf(address(vault)) + a.balanceOf(owner));
        }
        assertEq(usd.balanceOf(agent) + usd.balanceOf(attacker) + usd.balanceOf(address(agentHandler)), 0);
    }

    /// The token off the allowlist is never bought, by any route.
    function invariant_NeverHoldsAnAssetOffTheAllowlist() public view {
        assertEq(meme.totalSupply(), 0);
        assertEq(vault.holdings(address(meme)), 0);
        assertFalse(vault.getRule(address(meme)).allowed);
        assertFalse(agentHandler.tradedOffAllowlist());
    }

    /// After any agent buy, the asset is inside its exposure cap.
    function invariant_ExposureCapHoldsAfterEveryBuy() public view {
        assertFalse(agentHandler.exposureBroken());
    }

    /// No buy goes through in protect mode, in a cooldown, while paused, or
    /// for an asset whose price is at or below its stop price.
    function invariant_NoBuyingInProtectMode() public view {
        assertFalse(agentHandler.boughtWhileProtected());
        assertFalse(agentHandler.boughtBelowStop());
        assertFalse(agentHandler.tradedWhilePaused());
    }

    /// Trade size, daily volume and cost against the oracle price stay inside the policy.
    function invariant_AgentTradesStayInsideLimits() public view {
        assertFalse(agentHandler.sizeBroken());
        assertFalse(agentHandler.volumeBroken());
        assertFalse(agentHandler.costBroken());
    }

    /// The agent key cannot change the policy, the keys, or the pause state,
    /// and tokens sent to the vault do not move its valuation.
    function invariant_AgentCannotChangeTheRules() public view {
        assertFalse(agentHandler.policyTouched());
        assertEq(vault.agent(), agent);
        assertEq(vault.guardian(), guardian);
    }

    /// A looser policy or asset rule never takes effect before its waiting period.
    function invariant_LooseningAlwaysWaits() public view {
        assertFalse(ownerHandler.loosenedInstantly());
        assertFalse(ownerHandler.appliedEarly());
    }

    /// An owner-approved trade skips the size limits and nothing else.
    function invariant_ApprovalDoesNotBypassRiskRules() public view {
        assertFalse(ownerHandler.approvedTradeBrokeARule());
    }

    /// The stop-loss only fires at or below the stop price, and sells the whole holding.
    function invariant_StopLossOnlyFiresAtTheStopPrice() public view {
        assertFalse(agentHandler.stopFiredEarly());
    }

    function afterInvariant() public view {
        console.log("agent attempts", agentHandler.attempts(), "went through", agentHandler.trades());
        console.log("loosenings queued", ownerHandler.queued(), "applied after the wait", ownerHandler.applied());
        console.log("guardian vetoes", ownerHandler.vetoed());
        console.log("buys refused in protect mode", agentHandler.buysRefusedInProtectMode());
        console.log("stop-losses fired", agentHandler.stopLossesFired());
        _logRefusals("AssetNotAllowed", PolicyVault.AssetNotAllowed.selector);
        _logRefusals("UnknownAsset", PolicyVault.UnknownAsset.selector);
        _logRefusals("ExceedsTradeLimit", PolicyVault.ExceedsTradeLimit.selector);
        _logRefusals("ExceedsDailyVolume", PolicyVault.ExceedsDailyVolume.selector);
        _logRefusals("ExceedsExposure", PolicyVault.ExceedsExposure.selector);
        _logRefusals("ExceedsDailyLoss", PolicyVault.ExceedsDailyLoss.selector);
        _logRefusals("CooldownActive", PolicyVault.CooldownActive.selector);
        _logRefusals("BelowStopPrice", PolicyVault.BelowStopPrice.selector);
        _logRefusals("StalePrice", PolicyVault.StalePrice.selector);
        _logRefusals("WalletPaused", PolicyVault.WalletPaused.selector);
        _logRefusals("InsufficientBalance", PolicyVault.InsufficientBalance.selector);
        _logRefusals("ZeroAmount", PolicyVault.ZeroAmount.selector);
    }

    function _logRefusals(string memory name, bytes4 selector) internal view {
        console.log("  refused by", name, agentHandler.refusals(selector));
    }

    /// The vault's books never claim more than it holds.
    function invariant_BooksAreBacked() public view {
        assertLe(vault.holdings(address(usd)), usd.balanceOf(address(vault)));
        for (uint256 i = 0; i < 3; i++) {
            assertEq(vault.holdings(tokens[i]), IERC20(tokens[i]).balanceOf(address(vault)));
        }
    }
}

/// The same compromised agent, but its session key has expired.
contract ExpiredAgentKeyInvariantTest is InvariantFixture {
    uint256[3] held;

    function setUp() public override {
        super.setUp();
        vm.warp(vault.agentExpiry());
        market.wait(0);
        for (uint256 i = 0; i < 3; i++) {
            held[i] = vault.holdings(tokens[i]);
        }
    }

    /// The key makes no trade and no request. Holdings can still fall, because
    /// the stop-loss does not need the agent, but nothing is ever bought.
    function invariant_ExpiredKeyCanDoNothing() public view {
        assertEq(agentHandler.trades(), 0);
        assertEq(vault.requestCount(), 0);
        for (uint256 i = 0; i < 3; i++) {
            assertLe(vault.holdings(tokens[i]), held[i]);
        }
        assertEq(vault.holdings(address(meme)), 0);
    }
}

/// The same compromised agent, but the guardian has revoked its key.
contract RevokedAgentKeyInvariantTest is InvariantFixture {
    function setUp() public override {
        super.setUp();
        vm.prank(guardian);
        vault.revokeAgent();
    }

    function invariant_RevokedKeyCanDoNothing() public view {
        assertEq(agentHandler.trades(), 0);
        assertEq(vault.requestCount(), 0);
        assertEq(vault.agent(), address(0));
    }
}
