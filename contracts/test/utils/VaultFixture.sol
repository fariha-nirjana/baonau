// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyVault} from "../../src/PolicyVault.sol";
import {TestUSD} from "../../src/TestUSD.sol";
import {MockAsset} from "../../src/mocks/MockAsset.sol";
import {MockExchange} from "../../src/mocks/MockExchange.sol";
import {PriceOracle} from "../../src/mocks/PriceOracle.sol";

/// Shared setup: the simulated market and one vault holding 10,000 tUSD with
/// a conservative policy. The test contract itself is the oracle admin.
abstract contract VaultFixture is Test {
    PolicyVault vault;
    TestUSD usd;
    PriceOracle oracle;
    MockExchange exchange;
    MockAsset idx;
    MockAsset bond;
    MockAsset gold;
    MockAsset meme;

    address owner = makeAddr("owner");
    address guardian = makeAddr("guardian");
    address agent = makeAddr("agent");
    address updater = makeAddr("updater");
    address attacker = makeAddr("attacker");
    address stranger = makeAddr("stranger");

    uint256 constant USD = 1e6;
    uint256 constant PRICE = 1e8;
    uint256 constant FUNDS = 10_000 * USD;
    // 11% per trade, so a 1,000 tUSD trade still fits after fees have shaved the portfolio
    uint16 constant MAX_TRADE_BPS = 1100;
    uint16 constant MAX_DAILY_BPS = 3000;
    // 30% of the 10,000 deposited
    uint256 constant MAX_DAILY = 3_000 * USD;
    uint16 constant DAILY_LOSS_BPS = 800;
    uint16 constant SLIPPAGE_BPS = 100;
    uint16 constant MIN_DEFENSIVE_BPS = 2500;
    uint8 constant MAX_LOSS_STREAK = 3;
    uint32 constant COOLDOWN = 6 hours;
    uint256 constant FEE_BPS = 30;
    uint64 constant LOOSEN_DELAY = 1 days;
    uint64 constant MAX_PRICE_AGE = 1 hours;
    uint64 constant ORACLE_INTERVAL = 1 minutes;
    // the start of a UTC day
    uint256 constant START = 20_600 days;
    bytes32 constant REF = keccak256("decision-001");

    function setUp() public virtual {
        vm.warp(START);
        usd = new TestUSD();
        oracle = new PriceOracle(updater, ORACLE_INTERVAL);
        exchange = new MockExchange(usd, oracle, FEE_BPS);
        idx = new MockAsset("Simulated Index Fund", "tIDX", address(exchange));
        bond = new MockAsset("Simulated Bond Fund", "tBOND", address(exchange));
        gold = new MockAsset("Simulated Gold", "tGOLD", address(exchange));
        meme = new MockAsset("Moon Meme Coin", "MEME", address(exchange));
        oracle.addFeed(address(idx), 100 * PRICE, 1000);
        oracle.addFeed(address(bond), 100 * PRICE, 300);
        oracle.addFeed(address(gold), 250 * PRICE, 500);
        oracle.addFeed(address(meme), PRICE / 50, 5000);

        vault = new PolicyVault(usd, oracle, exchange, owner, guardian, LOOSEN_DELAY, MAX_PRICE_AGE);

        address[] memory assets = new address[](3);
        assets[0] = address(idx);
        assets[1] = address(bond);
        assets[2] = address(gold);
        PolicyVault.AssetRule[] memory rules = new PolicyVault.AssetRule[](3);
        rules[0] = PolicyVault.AssetRule(true, false, 5000, 0);
        // the bond fund is the defensive asset
        rules[1] = PolicyVault.AssetRule(true, true, 6000, 0);
        rules[2] = PolicyVault.AssetRule(true, false, 2000, 0);

        usd.mint(owner, FUNDS);
        vm.startPrank(owner);
        vault.initialize(_policy(), assets, rules);
        vault.setAgent(agent, uint64(START + 60 days));
        usd.approve(address(vault), type(uint256).max);
        vault.deposit(address(usd), FUNDS);
        vm.stopPrank();
    }

    function _policy() internal pure returns (PolicyVault.Policy memory) {
        return PolicyVault.Policy({
            maxTradeBps: MAX_TRADE_BPS,
            maxDailyVolumeBps: MAX_DAILY_BPS,
            dailyLossBps: DAILY_LOSS_BPS,
            maxSlippageBps: SLIPPAGE_BPS,
            minDefensiveBps: MIN_DEFENSIVE_BPS,
            maxLossStreak: MAX_LOSS_STREAK,
            cooldown: COOLDOWN
        });
    }

    function _buy(MockAsset asset, uint256 usdIn) internal returns (uint256) {
        vm.prank(agent);
        return vault.buy(address(asset), usdIn, REF);
    }

    function _sell(MockAsset asset, uint256 amount) internal returns (uint256) {
        vm.prank(agent);
        return vault.sell(address(asset), amount, REF);
    }

    /// Moves time past the oracle's minimum interval and pushes one price.
    function _setPrice(MockAsset asset, uint256 price) internal {
        skip(ORACLE_INTERVAL);
        vm.prank(updater);
        oracle.setPrice(address(asset), price);
    }

    /// Re-pushes every price so nothing is stale after a jump in time.
    function _refreshPrices() internal {
        address[4] memory all = [address(idx), address(bond), address(gold), address(meme)];
        vm.startPrank(updater);
        for (uint256 i = 0; i < all.length; i++) {
            (uint256 p,) = oracle.getPrice(all[i]);
            oracle.setPrice(all[i], p);
        }
        vm.stopPrank();
    }

    /// Fills the index holding to 4,000 tUSD over two UTC days.
    function _holdIndex() internal {
        _buy(idx, 1_000 * USD);
        _buy(idx, 1_000 * USD);
        _buy(idx, 1_000 * USD);
        skip(1 days);
        _refreshPrices();
        _buy(idx, 1_000 * USD);
    }
}
