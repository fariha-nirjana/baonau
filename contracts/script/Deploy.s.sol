// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

import {console} from "forge-std/Script.sol";
import {Mandate} from "../src/Mandate.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {MockAsset} from "../src/mocks/MockAsset.sol";
import {MockExchange} from "../src/mocks/MockExchange.sol";
import {PriceOracle} from "../src/mocks/PriceOracle.sol";
import {DemoVault} from "./DemoVault.sol";

/// Deploys everything from nothing: the simulated market (test dollars, three
/// simulated test assets, one token that stays off every mandate, the mock
/// price feed and the mock exchange), the vault factory, and one vault with
/// the demo mandate signed.
contract Deploy is DemoVault {
    TestUSD usd;
    PriceOracle oracle;
    MockExchange exchange;
    MockAsset idx;
    MockAsset bond;
    MockAsset gold;
    MockAsset meme;
    VaultFactory factory;

    function run() external {
        uint256 ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        address updater = vm.envAddress("ORACLE_UPDATER_ADDRESS");
        uint64 oracleMinInterval = uint64(vm.envOr("ORACLE_MIN_INTERVAL", uint256(4)));
        uint64 maxPriceAge = uint64(vm.envOr("MAX_PRICE_AGE", uint256(3600)));
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

        factory = new VaultFactory(usd, oracle, exchange, maxPriceAge);
        (Mandate mandate, PolicyVault vault) = _createVault(
            factory, usd, [address(idx), address(bond), address(gold)], vm.addr(ownerKey), vm.envOr("SIGN_MANDATE", true)
        );

        // the other keys need a little gas of their own
        if (gasGift > 0) {
            _gift(vm.envAddress("AGENT_ADDRESS"), gasGift);
            _gift(vm.envAddress("GUARDIAN_ADDRESS"), gasGift);
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
        console.log("FACTORY_ADDRESS=%s", address(factory));
        console.log("MANDATE_ADDRESS=%s", address(mandate));
        console.log("VAULT_ADDRESS=%s", address(vault));
    }

    function _gift(address to, uint256 amount) internal {
        if (to.balance >= amount) return;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "gas gift failed");
    }
}
