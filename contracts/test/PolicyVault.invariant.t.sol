// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {MockAsset} from "../src/mocks/MockAsset.sol";
import {PriceOracle} from "../src/mocks/PriceOracle.sol";
import {VaultFixture} from "./utils/VaultFixture.sol";

/// Threat A. Plays a fully compromised agent: it holds the real agent key and
/// fires random calls at everything that key can reach. After every call that
/// goes through, it checks the result against the mandate and records any breach.
contract CompromisedAgent is Test {
    uint256 constant BPS = 10_000;

    PolicyVault public vault;
    TestUSD public usd;
    PriceOracle public oracle;
    address public agent;
    address public attacker;
    address[] public tokens; // three allowlisted assets, then the one that is not

    bool public tradedOffAllowlist;
    bool public exposureBroken;
    bool public floorBroken;
    bool public boughtWhileProtected;
    bool public boughtBelowStop;
    bool public tradedWhilePaused;
    bool public sizeBroken;
    bool public volumeBroken;
    bool public costBroken;
    bool public streakBroken;
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
        // the fixture has already traded today
        volumeByDay[block.timestamp / 1 days] = vault_.volumeToday();
    }

    /// Random size, from nothing up to twice the per-trade limit.
    function buy(uint256 assetSeed, uint256 amount) external {
        _tryBuy(tokens[assetSeed % tokens.length], bound(amount, 0, 2 * _tradeLimit() + 1));
    }

    function sell(uint256 assetSeed, uint256 amount) external {
        address asset = tokens[assetSeed % tokens.length];
        (uint256 price,) = oracle.getPrice(asset);
        uint256 twiceTheLimit = 2 * _tradeLimit() * 1e20 / price;
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
            uint256 amount = _tradeLimit();
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
        // fees only ever lower the portfolio's value, so no leg can be larger than the limit at the start
        uint256 limit = _tradeLimit();
        uint256 volume;
        bool hasBuy;
        bool legTooBig;
        for (uint256 i = 0; i < legs; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            address asset = tokens[r % tokens.length];
            bool isBuy = (r >> 8) % 2 == 0;
            uint256 amount = isBuy ? bound(r >> 16, 0, 2 * limit + 1) : bound(r >> 16, 0, vault.holdings(asset));
            orders[i] = PolicyVault.Order(asset, isBuy, amount);
            uint256 value = isBuy ? amount : _usdValue(asset, amount);
            volume += value;
            if (value > limit) legTooBig = true;
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
                if (orders[i].isBuy && !vault.getRule(orders[i].asset).allowed) tradedOffAllowlist = true;
            }
            _afterTrade(volume, valueBefore, wasPaused);
        } catch {}
    }

    /// Ask for a trade above the limits, then try to approve it with the agent key.
    function requestAndSelfApprove(uint256 assetSeed, bool isBuy, uint256 amount) external {
        address asset = tokens[assetSeed % tokens.length];
        bytes32 before = _rulesHash();
        vm.startPrank(agent);
        try vault.requestTrade(asset, isBuy, bound(amount, 0, 1_000_000e6), bytes32(0)) returns (uint256 id) {
            try vault.approveRequest(id) {
                policyTouched = true;
            } catch {}
        } catch {}
        vm.stopPrank();
        if (_rulesHash() != before) policyTouched = true;
    }

    function callOwnerFunctions(uint256 amount, uint256 assetSeed) external {
        address asset = tokens[assetSeed % tokens.length];
        PolicyVault.Policy memory loose = PolicyVault.Policy(10_000, type(uint16).max, 10_000, 500, 0, 0, 0);
        PolicyVault.AssetRule memory open = PolicyVault.AssetRule(true, true, 10_000, 0);
        address[] memory assets = new address[](1);
        assets[0] = asset;
        PolicyVault.AssetRule[] memory rules = new PolicyVault.AssetRule[](1);
        rules[0] = open;
        bytes32[4] memory keys =
            [vault.POLICY_CHANGE(), vault.HALT_CHANGE(), vault.WITHDRAWAL_CHANGE(), vault.ruleKey(asset)];
        uint256 lastRequest = vault.requestCount();

        bytes32 before = _rulesHash();
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
        try vault.proposeWithdrawalAddress(attacker) {} catch {}
        try vault.applyWithdrawalAddress() {} catch {}
        try vault.haltStopLoss() {} catch {}
        try vault.applyStopLossHalt() {} catch {}
        try vault.resumeStopLoss() {} catch {}
        try vault.approveRequest(lastRequest) {} catch {}
        try vault.setAgent(attacker, uint64(block.timestamp + 90 days)) {} catch {}
        try vault.setGuardian(agent) {} catch {}
        try vault.transferGuardian(agent) {} catch {}
        for (uint256 i = 0; i < keys.length; i++) {
            try vault.cancelChange(keys[i]) {} catch {}
        }
        try vault.pause() {} catch {}
        try vault.unpause() {} catch {}
        // and straight at the tokens
        try usd.transferFrom(address(vault), agent, amount) {} catch {}
        try IERC20(asset).transferFrom(address(vault), agent, amount) {} catch {}
        vm.stopPrank();
        if (_rulesHash() != before || usd.balanceOf(address(vault)) != usdBefore) policyTouched = true;
    }

    /// Anyone can call the stop-loss. It must only fire at or below the stop
    /// price, never during a halt, and it must sell the whole holding.
    function triggerStopLoss(uint256 assetSeed) external {
        address asset = tokens[assetSeed % tokens.length];
        (uint256 price,) = oracle.getPrice(asset);
        uint256 stopPrice = vault.getRule(asset).stopPrice;
        bool halted = block.timestamp < vault.stopLossHaltedUntil();
        vm.prank(attacker);
        try vault.triggerStopLoss(asset) {
            stopLossesFired++;
            if (price > stopPrice || halted || vault.holdings(asset) != 0) stopFiredEarly = true;
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
        uint256 limit = _tradeLimit();
        uint256 valueBefore = vault.portfolioValue();
        attempts++;
        vm.prank(agent);
        try vault.buy(asset, amount, bytes32(0)) {
            if (wasProtected) boughtWhileProtected = true;
            if (belowStop) boughtBelowStop = true;
            if (amount > limit) sizeBroken = true;
            PolicyVault.AssetRule memory rule = vault.getRule(asset);
            if (!rule.allowed) tradedOffAllowlist = true;
            if (vault.exposureBps(asset) > rule.maxExposureBps) exposureBroken = true;
            if (!rule.defensive && vault.defensiveBps() < vault.getPolicy().minDefensiveBps) floorBroken = true;
            _afterTrade(amount, valueBefore, wasPaused);
        } catch (bytes memory err) {
            refusals[bytes4(err)]++;
            if (wasProtected) buysRefusedInProtectMode++;
        }
    }

    function _trySell(address asset, uint256 amount) internal {
        bool wasPaused = vault.paused();
        uint256 limit = _tradeLimit();
        uint256 valueBefore = vault.portfolioValue();
        uint256 value = _usdValue(asset, amount);
        attempts++;
        vm.prank(agent);
        try vault.sell(asset, amount, bytes32(0)) {
            if (value > limit) sizeBroken = true;
            // a full streak must have been turned into a cooldown and reset
            uint8 maxStreak = vault.getPolicy().maxLossStreak;
            if (maxStreak != 0 && vault.lossStreak() >= maxStreak) streakBroken = true;
            _afterTrade(value, valueBefore, wasPaused);
        } catch (bytes memory err) {
            refusals[bytes4(err)]++;
        }
    }

    function _afterTrade(uint256 usdValue, uint256 valueBefore, bool wasPaused) internal {
        trades++;
        PolicyVault.Policy memory p = vault.getPolicy();
        if (wasPaused) tradedWhilePaused = true;
        // the vault's count of today's agent volume must match ours and be inside the cap
        uint256 today = block.timestamp / 1 days;
        volumeByDay[today] += usdValue;
        if (volumeByDay[today] != vault.volumeToday()) volumeBroken = true;
        if (vault.volumeToday() > vault.dayStartValue() * p.maxDailyVolumeBps / BPS) volumeBroken = true;
        uint256 valueAfter = vault.portfolioValue();
        // prices did not move inside this call, so any drop in value is what the trade cost
        if (valueBefore > valueAfter && valueBefore - valueAfter > usdValue * p.maxSlippageBps / BPS + 4) {
            costBroken = true;
        }
    }

    function _tradeLimit() internal view returns (uint256) {
        return vault.portfolioValue() * vault.getPolicy().maxTradeBps / BPS;
    }

    function _usdValue(address asset, uint256 amount) internal view returns (uint256) {
        (uint256 price,) = oracle.getPrice(asset);
        return amount * price / 1e20;
    }

    /// Everything the agent must not be able to change.
    function _rulesHash() internal view returns (bytes32 h) {
        h = keccak256(
            abi.encode(
                vault.getPolicy(),
                vault.getPendingPolicy(),
                vault.agent(),
                vault.agentExpiry(),
                vault.guardian(),
                vault.paused(),
                vault.withdrawalAddress(),
                vault.pendingWithdrawalAddress(),
                vault.stopLossHaltedUntil(),
                vault.pendingEta(vault.POLICY_CHANGE()),
                vault.pendingEta(vault.HALT_CHANGE()),
                vault.pendingEta(vault.WITHDRAWAL_CHANGE()),
                vault.getAssets()
            )
        );
        for (uint256 i = 0; i < tokens.length; i++) {
            h = keccak256(
                abi.encode(
                    h, vault.getRule(tokens[i]), vault.getPendingRule(tokens[i]), vault.pendingEta(vault.ruleKey(tokens[i]))
                )
            );
        }
    }
}

/// Threat B. Plays the human side: an owner who keeps changing their mind,
/// mostly towards more risk, and a guardian who sometimes says no. It records
/// any change that raised the risk without waiting out the delay.
contract PanickingOwner is Test {
    PolicyVault public vault;
    TestUSD public usd;
    PriceOracle public oracle;
    address public owner;
    address public guardian;
    /// the only other address the owner ever asks to withdraw to
    address public secondAccount;
    address[] public tokens;

    bool public loosenedInstantly;
    bool public appliedEarly;
    bool public haltedWithoutWaiting;
    bool public withdrawalAddressMovedEarly;
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
        secondAccount = makeAddr("owner's second account");
    }

    function loosenPolicy(uint256 seed) external {
        // hashed because the fuzzer favours round numbers
        seed = uint256(keccak256(abi.encode(seed)));
        PolicyVault.Policy memory p = vault.getPolicy();
        uint256 field = seed % 7;
        uint256 r = seed >> 8;
        if (field == 0) p.maxTradeBps = uint16(bound(r, p.maxTradeBps, 10_000));
        else if (field == 1) p.maxDailyVolumeBps = uint16(bound(r, p.maxDailyVolumeBps, 30_000));
        else if (field == 2) p.dailyLossBps = uint16(bound(r, p.dailyLossBps, 10_000));
        else if (field == 3) p.maxSlippageBps = uint16(bound(r, p.maxSlippageBps, 500));
        else if (field == 4) p.minDefensiveBps = uint16(bound(r, 0, p.minDefensiveBps));
        else if (field == 5) p.maxLossStreak = r % 3 == 0 ? 0 : uint8(bound(r, p.maxLossStreak, 20));
        else p.cooldown = uint32(bound(r, 0, p.cooldown));
        _propose(p);
    }

    function tightenPolicy(uint256 seed) external {
        seed = uint256(keccak256(abi.encode(seed)));
        PolicyVault.Policy memory p = vault.getPolicy();
        uint256 field = seed % 7;
        uint256 r = seed >> 8;
        // floors keep the agent able to act, so the run keeps testing something
        if (field == 0 && p.maxTradeBps > 300) p.maxTradeBps = uint16(bound(r, 300, p.maxTradeBps));
        else if (field == 1 && p.maxDailyVolumeBps > 1_000) p.maxDailyVolumeBps = uint16(bound(r, 1_000, p.maxDailyVolumeBps));
        else if (field == 2 && p.dailyLossBps > 200) p.dailyLossBps = uint16(bound(r, 200, p.dailyLossBps));
        else if (field == 3 && p.maxSlippageBps > 50) p.maxSlippageBps = uint16(bound(r, 50, p.maxSlippageBps));
        else if (field == 4 && p.minDefensiveBps < 5_000) p.minDefensiveBps = uint16(bound(r, p.minDefensiveBps, 5_000));
        else if (field == 5 && p.maxLossStreak > 2) p.maxLossStreak = uint8(bound(r, 2, p.maxLossStreak));
        else if (p.cooldown < 2 days) p.cooldown = uint32(bound(r, p.cooldown, 2 days));
        _propose(p);
    }

    function applyPolicy(bool waitFirst) external {
        uint64 eta = vault.pendingEta(vault.POLICY_CHANGE());
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
        if (seed % 5 == 0) rule.maxExposureBps = uint16(bound(r, old.maxExposureBps, 10_000));
        else if (seed % 5 == 1) rule.maxExposureBps = uint16(bound(r, 1_000, 10_000));
        else if (seed % 5 == 2) rule.stopPrice = bound(r, 0, price);
        else if (seed % 5 == 3) rule.stopPrice = bound(r, old.stopPrice, old.stopPrice > price ? old.stopPrice : price);
        else rule.defensive = !old.defensive;
        _proposeRule(asset, rule);
    }

    function applyRule(uint256 assetSeed, bool waitFirst) external {
        address asset = tokens[assetSeed % 3];
        uint64 eta = vault.pendingEta(vault.ruleKey(asset));
        if (waitFirst && eta > block.timestamp) vm.warp(eta);
        vm.prank(owner);
        try vault.applyAssetRule(asset) {
            applied++;
            if (eta == 0 || block.timestamp < eta) appliedEarly = true;
        } catch {}
    }

    /// A panicking owner tries to let the agent buy the token that is pumping.
    function tryToAllowTheMemeCoin() external {
        bytes32 key = vault.ruleKey(tokens[3]);
        vm.prank(owner);
        try vault.proposeAssetRule(tokens[3], PolicyVault.AssetRule(true, true, 10_000, 0)) {} catch {}
        if (vault.getRule(tokens[3]).allowed) loosenedInstantly = true;
        // the guardian always vetoes this one, so the token stays off the allowlist for the whole run
        vm.prank(guardian);
        try vault.cancelChange(key) {
            vetoed++;
        } catch {}
    }

    /// Takes an asset off the allowlist (instant) or asks to put it back (waits).
    function delistOrRelist(uint256 assetSeed) external {
        address asset = tokens[assetSeed % 3];
        PolicyVault.AssetRule memory rule = vault.getRule(asset);
        rule.allowed = !rule.allowed;
        _proposeRule(asset, rule);
    }

    /// "Don't sell, it will come back": the owner tries to switch the stop-loss off.
    function ownerTriesToHaltTheStopLoss() external {
        uint64 before = vault.stopLossHaltedUntil();
        vm.prank(owner);
        vault.haltStopLoss();
        if (vault.stopLossHaltedUntil() != before) haltedWithoutWaiting = true;
        queued++;
    }

    function applyHalt(bool waitFirst) external {
        uint64 eta = vault.pendingEta(vault.HALT_CHANGE());
        if (waitFirst && eta > block.timestamp) vm.warp(eta);
        vm.prank(owner);
        try vault.applyStopLossHalt() {
            applied++;
            if (eta == 0 || block.timestamp < eta) haltedWithoutWaiting = true;
        } catch {}
    }

    /// The guardian's emergency halt, or either of them switching the stop-loss back on.
    function guardianHaltsOrSomeoneResumes(uint256 seed) external {
        seed = uint256(keccak256(abi.encode(seed)));
        if (seed % 4 == 0) {
            vm.prank(guardian);
            vault.haltStopLoss();
        } else {
            vm.prank(seed % 2 == 0 ? owner : guardian);
            vault.resumeStopLoss();
        }
    }

    /// "Update your withdrawal address": the owner asks to send withdrawals somewhere else.
    function askToMoveTheWithdrawalAddress(bool back) external {
        address before = vault.withdrawalAddress();
        vm.prank(owner);
        vault.proposeWithdrawalAddress(back ? owner : secondAccount);
        if (vault.withdrawalAddress() != before) withdrawalAddressMovedEarly = true;
        queued++;
    }

    function applyWithdrawalAddress(bool waitFirst) external {
        uint64 eta = vault.pendingEta(vault.WITHDRAWAL_CHANGE());
        if (waitFirst && eta > block.timestamp) vm.warp(eta);
        vm.prank(owner);
        try vault.applyWithdrawalAddress() {
            applied++;
            if (eta == 0 || block.timestamp < eta) withdrawalAddressMovedEarly = true;
        } catch {}
    }

    function guardianVetoes(uint256 seed) external {
        bytes32[3] memory keys = [vault.POLICY_CHANGE(), vault.HALT_CHANGE(), vault.WITHDRAWAL_CHANGE()];
        vm.prank(guardian);
        try vault.cancelChange(keys[seed % 3]) {
            vetoed++;
        } catch {}
    }

    /// Mostly unpauses, so the run spends most of its time with a live agent.
    function pauseOrUnpause(uint256 seed) external {
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
                if (!rule.defensive && vault.defensiveBps() < vault.getPolicy().minDefensiveBps) {
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
        bool streakOk = cur.maxLossStreak == old.maxLossStreak
            || (cur.maxLossStreak != 0 && (old.maxLossStreak == 0 || cur.maxLossStreak < old.maxLossStreak));
        bool tighterOrSame = streakOk && cur.maxTradeBps <= old.maxTradeBps
            && cur.maxDailyVolumeBps <= old.maxDailyVolumeBps && cur.dailyLossBps <= old.dailyLossBps
            && cur.maxSlippageBps <= old.maxSlippageBps && cur.minDefensiveBps >= old.minDefensiveBps
            && cur.cooldown >= old.cooldown;
        if (!tighterOrSame) loosenedInstantly = true;
        if (vault.pendingEta(vault.POLICY_CHANGE()) != 0) queued++;
    }

    function _proposeRule(address asset, PolicyVault.AssetRule memory rule) internal {
        PolicyVault.AssetRule memory old = vault.getRule(asset);
        vm.prank(owner);
        try vault.proposeAssetRule(asset, rule) {} catch {
            return;
        }
        PolicyVault.AssetRule memory cur = vault.getRule(asset);
        bool tighterOrSame = (!cur.allowed || old.allowed) && (!cur.defensive || old.defensive)
            && cur.maxExposureBps <= old.maxExposureBps && cur.stopPrice >= old.stopPrice;
        if (!tighterOrSame) loosenedInstantly = true;
        if (vault.pendingEta(vault.ruleKey(asset)) != 0) queued++;
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
        vm.prank(owner);
        vault.proposeAssetRule(address(idx), PolicyVault.AssetRule(true, false, 5000, 85 * PRICE));

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
    /// Every test dollar is in the vault, with the exchange, or at an address
    /// the owner registered for withdrawals.
    function invariant_FundsOnlyLeaveToTheWithdrawalAddress() public view {
        address second = ownerHandler.secondAccount();
        assertEq(
            usd.totalSupply(),
            usd.balanceOf(address(vault)) + usd.balanceOf(address(exchange)) + usd.balanceOf(owner)
                + usd.balanceOf(second)
        );
        for (uint256 i = 0; i < 3; i++) {
            MockAsset a = MockAsset(tokens[i]);
            assertEq(a.totalSupply(), a.balanceOf(address(vault)) + a.balanceOf(owner) + a.balanceOf(second));
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

    /// After any agent buy, the asset is inside its exposure cap and enough is
    /// left in cash and defensive assets.
    function invariant_PortfolioRulesHoldAfterEveryBuy() public view {
        assertFalse(agentHandler.exposureBroken());
        assertFalse(agentHandler.floorBroken());
    }

    /// No buy goes through in protect mode, in a cooldown, while paused, or
    /// for an asset whose price is at or below its stop price. A full run of
    /// losing sells always ends in a cooldown.
    function invariant_NoBuyingInProtectMode() public view {
        assertFalse(agentHandler.boughtWhileProtected());
        assertFalse(agentHandler.boughtBelowStop());
        assertFalse(agentHandler.tradedWhilePaused());
        assertFalse(agentHandler.streakBroken());
    }

    /// Trade size, daily volume and cost against the oracle price stay inside the mandate.
    function invariant_AgentTradesStayInsideLimits() public view {
        assertFalse(agentHandler.sizeBroken());
        assertFalse(agentHandler.volumeBroken());
        assertFalse(agentHandler.costBroken());
    }

    /// The agent key cannot change the mandate, the keys, the pause state, the
    /// stop-loss halt or the withdrawal address, and tokens sent to the vault
    /// do not move its valuation.
    function invariant_AgentCannotChangeTheRules() public view {
        assertFalse(agentHandler.policyTouched());
        assertEq(vault.agent(), agent);
        assertEq(vault.guardian(), guardian);
    }

    /// Threat B. Nothing that raises the risk takes effect before its waiting
    /// period: a looser mandate or asset rule, an owner's halt of the
    /// stop-loss, or a new withdrawal address.
    function invariant_RiskOnlyGoesUpAfterTheDelay() public view {
        assertFalse(ownerHandler.loosenedInstantly());
        assertFalse(ownerHandler.appliedEarly());
        assertFalse(ownerHandler.haltedWithoutWaiting());
        assertFalse(ownerHandler.withdrawalAddressMovedEarly());
    }

    /// An owner-approved trade skips the size limits and nothing else.
    function invariant_ApprovalDoesNotBypassRiskRules() public view {
        assertFalse(ownerHandler.approvedTradeBrokeARule());
    }

    /// The stop-loss only fires at or below the stop price and outside a halt,
    /// and sells the whole holding.
    function invariant_StopLossOnlyFiresAtTheStopPrice() public view {
        assertFalse(agentHandler.stopFiredEarly());
    }

    /// The vault's books never claim more than it holds.
    function invariant_BooksAreBacked() public view {
        assertLe(vault.holdings(address(usd)), usd.balanceOf(address(vault)));
        for (uint256 i = 0; i < 3; i++) {
            assertEq(vault.holdings(tokens[i]), IERC20(tokens[i]).balanceOf(address(vault)));
        }
    }

    function afterInvariant() public view {
        console.log("agent attempts", agentHandler.attempts(), "went through", agentHandler.trades());
        console.log("risk increases queued", ownerHandler.queued(), "applied after the wait", ownerHandler.applied());
        console.log("guardian vetoes", ownerHandler.vetoed());
        console.log("buys refused in protect mode", agentHandler.buysRefusedInProtectMode());
        console.log("stop-losses fired", agentHandler.stopLossesFired());
        _logRefusals("AssetNotAllowed", PolicyVault.AssetNotAllowed.selector);
        _logRefusals("ExceedsTradeLimit", PolicyVault.ExceedsTradeLimit.selector);
        _logRefusals("ExceedsDailyVolume", PolicyVault.ExceedsDailyVolume.selector);
        _logRefusals("ExceedsExposure", PolicyVault.ExceedsExposure.selector);
        _logRefusals("BelowDefensiveFloor", PolicyVault.BelowDefensiveFloor.selector);
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
