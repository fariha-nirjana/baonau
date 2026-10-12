// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {IExchange} from "../src/interfaces/IExchange.sol";
import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";

/// Shared by the deploy scripts: creates one vault for the demo investor,
/// signs the demo mandate, gives the agent a session key and deposits cash.
abstract contract DemoVault is Script {
    uint256 constant PRICE = 1e8;

    struct Market {
        TestUSD usd;
        IPriceOracle oracle;
        IExchange exchange;
        address idx;
        address bond;
        address gold;
    }

    /// @param signMandate false leaves the vault without a mandate, for the scene
    /// where the investor states a goal and signs the mandate the agent drafts
    function _deployVault(Market memory m, address owner, bool signMandate) internal returns (PolicyVault vault) {
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        address agent = vm.envAddress("AGENT_ADDRESS");
        // short waits so they can be shown live; a real vault would use a day or more
        uint64 loosenDelay = uint64(vm.envOr("LOOSEN_DELAY", uint256(120)));
        uint64 maxPriceAge = uint64(vm.envOr("MAX_PRICE_AGE", uint256(3600)));
        // the demo investor starts with 5,000 taka, shown at a fixed demo rate of 122 taka to 1 tUSD
        uint256 deposit = vm.envOr("DEPOSIT_USD_UNITS", uint256(40_983_606));

        vault = new PolicyVault(IERC20(address(m.usd)), m.oracle, m.exchange, owner, guardian, loosenDelay, maxPriceAge);

        if (signMandate) {
            address[] memory assets = new address[](3);
            assets[0] = m.idx;
            assets[1] = m.bond;
            assets[2] = m.gold;
            PolicyVault.AssetRule[] memory rules = new PolicyVault.AssetRule[](3);
            // index fund: at most 40%, sold for the investor if it falls to 102 (it starts at 120)
            rules[0] = PolicyVault.AssetRule(true, false, 4000, 102 * PRICE);
            // bond fund: at most 60%, counts as defensive
            rules[1] = PolicyVault.AssetRule(true, true, 6000, 0);
            // gold: at most 20%
            rules[2] = PolicyVault.AssetRule(true, false, 2000, 0);
            vault.initialize(
                PolicyVault.Policy({
                    maxTradeBps: 1000,
                    maxDailyVolumeBps: 4000,
                    dailyLossBps: 800,
                    maxSlippageBps: 100,
                    minDefensiveBps: 2500,
                    maxLossStreak: 3,
                    cooldown: 10 minutes
                }),
                assets,
                rules
            );
        }
        vault.setAgent(agent, uint64(block.timestamp + 60 days));

        m.usd.mint(owner, deposit);
        m.usd.approve(address(vault), deposit);
        vault.deposit(address(m.usd), deposit);
    }
}
