// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

import {Test} from "forge-std/Test.sol";
import {Mandate} from "../../src/Mandate.sol";
import {PolicyVault} from "../../src/PolicyVault.sol";
import {TestUSD} from "../../src/TestUSD.sol";
import {AssetRule, Policy} from "../../src/Types.sol";
import {VaultFactory} from "../../src/VaultFactory.sol";
import {MockAsset} from "../../src/mocks/MockAsset.sol";
import {MockExchange} from "../../src/mocks/MockExchange.sol";
import {PriceOracle} from "../../src/mocks/PriceOracle.sol";

/// The contracts' events, declared again so tests can expect them. This
/// compiler cannot emit another contract's event by name.
abstract contract Events {
    event Trade(address indexed asset, bool isBuy, uint256 usdAmount, uint256 assetAmount, uint256 price, bytes32 ref, address indexed by);
    event StopLossTriggered(address indexed asset, uint256 assetAmount, uint256 usdAmount, uint256 price, address indexed by);
    event ProtectModeEntered(PolicyVault.Trigger trigger, uint256 drawdownBps, uint64 until);
    event ApprovalUsed(uint256 indexed nonce, uint8 action, address assetIn, address assetOut, uint256 amount);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    event StopLossHaltProposed(uint64 eta);
    event WithdrawalAddressProposed(address indexed to, uint64 eta);
    event AgentProposed(address indexed agent, uint64 expiry, uint64 eta);
    event GuardianProposed(address indexed guardian, uint64 eta);
    event UnpauseProposed(uint64 eta);
    event ChangeCancelled(bytes32 indexed key, address indexed by);
    event Terminated();
    event VaultCreated(address indexed owner, address indexed mandate, address indexed vault, uint64 activeFrom);
    event PriceUpdated(address indexed asset, uint256 price, uint256 previous);
}

/// Shared setup: the simulated market, the factory, and one vault with its
/// mandate, holding 10,000 tUSD under a conservative mandate. The test
/// contract itself is the oracle admin.
abstract contract VaultFixture is Test, Events {
    VaultFactory factory;
    Mandate mandate;
    PolicyVault vault;
    TestUSD usd;
    PriceOracle oracle;
    MockExchange exchange;
    MockAsset idx;
    MockAsset bond;
    MockAsset gold;
    MockAsset meme;

    // the owner signs trade approvals in some tests, so its key is needed
    uint256 constant OWNER_KEY = 0xA11CE;
    address owner = vm.addr(OWNER_KEY);
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
    uint64 constant AGENT_EXPIRY = uint64(START + 60 days);
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

        factory = new VaultFactory(usd, oracle, exchange, MAX_PRICE_AGE);
        usd.mint(owner, FUNDS);
        vm.startPrank(owner);
        (mandate, vault) = factory.createVault(guardian, LOOSEN_DELAY);
        (address[] memory assets, AssetRule[] memory rules) = _assetRules();
        mandate.signMandate(_policy(), assets, rules, agent, AGENT_EXPIRY);
        usd.approve(address(vault), type(uint256).max);
        vault.deposit(address(usd), FUNDS);
        vm.stopPrank();
    }

    function _assetRules() internal view returns (address[] memory assets, AssetRule[] memory rules) {
        assets = new address[](3);
        assets[0] = address(idx);
        assets[1] = address(bond);
        assets[2] = address(gold);
        rules = new AssetRule[](3);
        rules[0] = AssetRule(true, false, 5000, 0);
        // the bond fund is the defensive asset
        rules[1] = AssetRule(true, true, 6000, 0);
        rules[2] = AssetRule(true, false, 2000, 0);
    }

    function _policy() internal pure returns (Policy memory) {
        return Policy({
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

    /// An approval for one trade, valid from now for `lifetime` seconds, signed with `key`.
    function _approval(bool isBuy, MockAsset asset, uint256 amount, uint256 nonce, uint64 lifetime, uint256 key)
        internal
        view
        returns (PolicyVault.TradeApproval memory a, bytes memory signature)
    {
        a = PolicyVault.TradeApproval({
            action: isBuy ? 0 : 1,
            assetIn: isBuy ? address(usd) : address(asset),
            assetOut: isBuy ? address(asset) : address(usd),
            amount: amount,
            nonce: nonce,
            validFrom: uint64(block.timestamp),
            expiry: uint64(block.timestamp) + lifetime
        });
        signature = _sign(a, key);
    }

    function _sign(PolicyVault.TradeApproval memory a, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, vault.approvalDigest(a));
        return abi.encodePacked(r, s, v);
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
