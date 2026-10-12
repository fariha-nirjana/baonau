// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console} from "forge-std/Script.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {IExchange} from "../src/interfaces/IExchange.sol";
import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";
import {DemoVault} from "./DemoVault.sol";

/// Deploys one more vault on the market that Deploy.s.sol created.
/// Set SIGN_MANDATE=false for a vault that still waits for its first mandate.
contract DeployVault is DemoVault {
    function run() external {
        uint256 ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        Market memory m = Market({
            usd: TestUSD(vm.envAddress("USD_ADDRESS")),
            oracle: IPriceOracle(vm.envAddress("ORACLE_ADDRESS")),
            exchange: IExchange(vm.envAddress("EXCHANGE_ADDRESS")),
            idx: vm.envAddress("IDX_ADDRESS"),
            bond: vm.envAddress("BOND_ADDRESS"),
            gold: vm.envAddress("GOLD_ADDRESS")
        });

        vm.startBroadcast(ownerKey);
        PolicyVault vault = _deployVault(m, vm.addr(ownerKey), vm.envOr("SIGN_MANDATE", true));
        vm.stopBroadcast();

        console.log("VAULT_ADDRESS=%s", address(vault));
    }
}
