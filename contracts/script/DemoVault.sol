// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

import {Script} from "forge-std/Script.sol";
import {Mandate} from "../src/Mandate.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {AssetRule, Policy} from "../src/Types.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// Shared by the deploy scripts: creates one vault and its mandate for the
/// demo investor, signs the demo mandate, and deposits cash.
abstract contract DemoVault is Script {
    uint256 constant PRICE = 1e8;

    /// @param signMandate false leaves the mandate unsigned, for the scene where
    /// the investor states a goal and signs the mandate the agent drafts
    function _createVault(VaultFactory factory, TestUSD usd, address[3] memory assets, address owner, bool signMandate)
        internal
        returns (Mandate mandate, PolicyVault vault)
    {
        // short waits so they can be shown live; a real vault would use a day or more
        uint64 loosenDelay = uint64(vm.envOr("LOOSEN_DELAY", uint256(120)));
        // the demo investor starts with 5,000 taka, shown at a fixed demo rate of 122 taka to 1 tUSD
        uint256 deposit = vm.envOr("DEPOSIT_USD_UNITS", uint256(40_983_606));

        (mandate, vault) = factory.createVault(vm.envAddress("GUARDIAN_ADDRESS"), loosenDelay);

        if (signMandate) {
            address[] memory list = new address[](3);
            AssetRule[] memory rules = new AssetRule[](3);
            // index fund: at most 40%, sold for the investor if it falls to 102 (it starts at 120)
            (list[0], rules[0]) = (assets[0], AssetRule(true, false, 4000, 102 * PRICE));
            // bond fund: at most 60%, counts as defensive
            (list[1], rules[1]) = (assets[1], AssetRule(true, true, 6000, 0));
            // gold: at most 20%
            (list[2], rules[2]) = (assets[2], AssetRule(true, false, 2000, 0));
            mandate.signMandate(
                Policy({
                    maxTradeBps: 1000,
                    maxDailyVolumeBps: 4000,
                    dailyLossBps: 800,
                    maxSlippageBps: 100,
                    minDefensiveBps: 2500,
                    maxLossStreak: 3,
                    cooldown: 10 minutes
                }),
                list,
                rules,
                vm.envAddress("AGENT_ADDRESS"),
                uint64(block.timestamp + 60 days)
            );
        }

        usd.mint(owner, deposit);
        usd.approve(address(vault), deposit);
        vault.deposit(address(usd), deposit);
    }
}
