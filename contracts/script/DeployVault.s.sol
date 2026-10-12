// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

import {console} from "forge-std/Script.sol";
import {Mandate} from "../src/Mandate.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {DemoVault} from "./DemoVault.sol";

/// Creates one more vault from the factory that Deploy.s.sol deployed.
/// Set SIGN_MANDATE=false for a vault whose first mandate is still to be signed.
/// An owner's second and later vaults can only be signed after the waiting
/// period, so for those SIGN_MANDATE must be false and the signing comes later.
contract DeployVault is DemoVault {
    function run() external {
        uint256 ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        VaultFactory factory = VaultFactory(vm.envAddress("FACTORY_ADDRESS"));
        address[3] memory assets = [vm.envAddress("IDX_ADDRESS"), vm.envAddress("BOND_ADDRESS"), vm.envAddress("GOLD_ADDRESS")];

        vm.startBroadcast(ownerKey);
        (Mandate mandate, PolicyVault vault) =
            _createVault(factory, TestUSD(vm.envAddress("USD_ADDRESS")), assets, vm.addr(ownerKey), vm.envOr("SIGN_MANDATE", false));
        vm.stopBroadcast();

        console.log("MANDATE_ADDRESS=%s", address(mandate));
        console.log("VAULT_ADDRESS=%s", address(vault));
        console.log("first mandate can be signed from (unix time): %s", mandate.activeFrom());
    }
}
