// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {MockAsset} from "../src/mocks/MockAsset.sol";
import {MockExchange} from "../src/mocks/MockExchange.sol";
import {PriceOracle} from "../src/mocks/PriceOracle.sol";

/// Deploys the simulated market (test dollars, three simulated tokenized assets,
/// one token that stays off the allowlist, the price oracle and the mock
/// exchange) and one vault with a demo policy, 10,000 tUSD and an agent key.
contract Deploy is Script {
    uint256 constant USD = 1e6;
    uint256 constant PRICE = 1e8;

    TestUSD usd;
    PriceOracle oracle;
    MockExchange exchange;
    MockAsset idx;
    MockAsset bond;
    MockAsset gold;
    MockAsset meme;
    PolicyVault vault;

    function run() external {
        uint256 ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        address owner = vm.addr(ownerKey);
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        address agent = vm.envAddress("AGENT_ADDRESS");
        address updater = vm.envAddress("ORACLE_UPDATER_ADDRESS");
        // short waits so they can be shown live; a real vault would use a day or more
        uint64 loosenDelay = uint64(vm.envOr("LOOSEN_DELAY", uint256(120)));
        uint64 maxPriceAge = uint64(vm.envOr("MAX_PRICE_AGE", uint256(3600)));
        uint64 oracleMinInterval = uint64(vm.envOr("ORACLE_MIN_INTERVAL", uint256(4)));
        uint256 gasGift = vm.envOr("GAS_GIFT_WEI", uint256(0.00003 ether));

        vm.startBroadcast(ownerKey);

        usd = new TestUSD();
        oracle = new PriceOracle(updater, oracleMinInterval);
        exchange = new MockExchange(usd, oracle, 30);

        idx = new MockAsset("Simulated Index Fund", "tIDX", address(exchange));
        bond = new MockAsset("Simulated Bond Fund", "tBOND", address(exchange));
        gold = new MockAsset("Simulated Gold", "tGOLD", address(exchange));
        meme = new MockAsset("Moon Meme Coin", "MEME", address(exchange));

        // start price and the most one update may move it
        oracle.addFeed(address(idx), 120 * PRICE, 1000);
        oracle.addFeed(address(bond), 100 * PRICE, 300);
        oracle.addFeed(address(gold), 250 * PRICE, 500);
        oracle.addFeed(address(meme), PRICE / 50, 5000);

        vault = new PolicyVault(usd, oracle, exchange, owner, guardian, loosenDelay, maxPriceAge);

        address[] memory assets = new address[](3);
        assets[0] = address(idx);
        assets[1] = address(bond);
        assets[2] = address(gold);
        PolicyVault.AssetRule[] memory rules = new PolicyVault.AssetRule[](3);
        rules[0] = PolicyVault.AssetRule(true, 4000, 102 * PRICE);
        rules[1] = PolicyVault.AssetRule(true, 6000, 0);
        rules[2] = PolicyVault.AssetRule(true, 2000, 0);
        vault.initialize(
            PolicyVault.Policy({
                maxTradeUsd: 500 * USD,
                maxDailyVolumeUsd: 2_000 * USD,
                dailyLossBps: 800,
                maxSlippageBps: 100,
                cooldown: 10 minutes
            }),
            assets,
            rules
        );
        vault.setAgent(agent, uint64(block.timestamp + 60 days));

        usd.mint(owner, 10_000 * USD);
        usd.approve(address(vault), 10_000 * USD);
        vault.deposit(address(usd), 10_000 * USD);

        // the other keys need a little gas of their own
        if (gasGift > 0) {
            _gift(agent, gasGift);
            _gift(guardian, gasGift);
            _gift(updater, gasGift);
        }

        vm.stopBroadcast();

        console.log("USD_ADDRESS=%s", address(usd));
        console.log("ORACLE_ADDRESS=%s", address(oracle));
        console.log("EXCHANGE_ADDRESS=%s", address(exchange));
        console.log("IDX_ADDRESS=%s", address(idx));
        console.log("BOND_ADDRESS=%s", address(bond));
        console.log("GOLD_ADDRESS=%s", address(gold));
        console.log("MEME_ADDRESS=%s", address(meme));
        console.log("VAULT_ADDRESS=%s", address(vault));
    }

    function _gift(address to, uint256 amount) internal {
        if (to.balance >= amount) return;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "gas gift failed");
    }
}
