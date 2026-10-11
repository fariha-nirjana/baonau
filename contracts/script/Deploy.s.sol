// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PolicyWallet} from "../src/PolicyWallet.sol";
import {TestUSD} from "../src/TestUSD.sol";

/// Deploys the test token and the wallet, then sets up the demo policy:
/// three buckets, two mandates, an agent session key and 10,000 tUSD unallocated.
contract Deploy is Script {
    uint256 constant USD = 1e6;

    function run() external {
        uint256 ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        address owner = vm.addr(ownerKey);
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        address agent = vm.envAddress("AGENT_ADDRESS");
        address university = vm.envAddress("UNIVERSITY_ADDRESS");
        address landlord = vm.envAddress("LANDLORD_ADDRESS");
        // short delays so the waiting period can be shown live; a real wallet would use a day or more
        uint64 mandateDelay = uint64(vm.envOr("MANDATE_DELAY", uint256(120)));
        uint64 loosenDelay = uint64(vm.envOr("LOOSEN_DELAY", uint256(120)));
        uint256 gasGift = vm.envOr("GAS_GIFT_WEI", uint256(0.0001 ether));

        vm.startBroadcast(ownerKey);

        TestUSD token = new TestUSD();
        PolicyWallet wallet =
            new PolicyWallet(token, owner, guardian, 2_000 * USD, 3_000 * USD, mandateDelay, loosenDelay);

        wallet.setAgent(agent, uint64(block.timestamp + 60 days));
        uint256 tuition = wallet.createBucket("Tuition", true);
        uint256 rent = wallet.createBucket("Rent", true);
        wallet.createBucket("Living", false);

        uint64 expiry = uint64(block.timestamp + 365 days);
        wallet.createMandate(university, tuition, 5_000 * USD, 30 days, expiry, "Tuition, fall 2026");
        wallet.createMandate(landlord, rent, 800 * USD, 30 days, expiry, "Rent");

        token.mint(address(wallet), 10_000 * USD);

        // the agent and guardian keys need a little gas of their own
        if (gasGift > 0) {
            (bool a,) = agent.call{value: gasGift}("");
            (bool g,) = guardian.call{value: gasGift}("");
            require(a && g, "gas gift failed");
        }

        vm.stopBroadcast();

        console.log("TOKEN_ADDRESS=%s", address(token));
        console.log("WALLET_ADDRESS=%s", address(wallet));
    }
}
