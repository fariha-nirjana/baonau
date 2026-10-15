// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Mandate} from "../src/Mandate.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {AssetRule, Commitment, Policy} from "../src/Types.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {MockAsset} from "../src/mocks/MockAsset.sol";
import {PriceOracle} from "../src/mocks/PriceOracle.sol";
import {VaultFixture} from "./utils/VaultFixture.sol";

/// Threat B. Plays the human side: an owner who keeps changing their mind,
/// mostly towards more risk, and a guardian who sometimes says no. For every
/// change it works out on its own whether the change lowers or raises risk,
/// then records it if the mandate did anything else: a rise in risk that
/// applied at once, or a cut in risk that was made to wait.
contract PanickingOwner is Test {
    Mandate public mandate;
    PolicyVault public vault;
    TestUSD public usd;
    PriceOracle public oracle;
    uint256 internal ownerKey;
    address public owner;
    address public guardian;
    address public agent;
    address public updater;
    /// the only other address the owner ever asks to withdraw to
    address public secondAccount;
    address[] public tokens;

    bool public loosenedInstantly;
    bool public tighteningDelayed;
    bool public appliedEarly;
    bool public guardianVetoedOwnRemoval;
    bool public newVaultSignedEarly;
    bool public signedTwice;
    bool public withdrawalMisdirected;
    bool public terminationMissed;
    /// our own record of whose pause it is, kept apart from what the contract says
    bool internal guardianHoldsThePause;
    VaultFactory public factory;
    /// another owner's vault, for approvals signed for the wrong one
    PolicyVault public decoy;
    bool public approvalIsForTheDecoy;

    /// the one payee in the run, and what the owner has paid it
    address public landlord = makeAddr("landlord");
    uint256 public paidByOwner;

    uint256 public queued;
    uint256 public applied;
    uint256 public vetoed;
    uint256 public tightened;

    PolicyVault.TradeApproval internal _approval;
    bytes internal _signature;
    bool public hasApproval;
    uint256 public nextNonce = 1;

    constructor(
        Mandate mandate_,
        PolicyVault vault_,
        TestUSD usd_,
        PriceOracle oracle_,
        uint256 ownerKey_,
        address guardian_,
        address agent_,
        address updater_,
        address[] memory tokens_,
        VaultFactory factory_,
        PolicyVault decoy_
    ) {
        factory = factory_;
        decoy = decoy_;
        updater = updater_;
        mandate = mandate_;
        vault = vault_;
        usd = usd_;
        oracle = oracle_;
        ownerKey = ownerKey_;
        owner = vm.addr(ownerKey_);
        guardian = guardian_;
        agent = agent_;
        tokens = tokens_;
        secondAccount = makeAddr("owner's second account");
    }

    // ---- the mandate's limits

    function loosenPolicy(uint256 seed) external {
        // hashed because the fuzzer favours round numbers
        seed = uint256(keccak256(abi.encode(seed)));
        Policy memory p = mandate.getPolicy();
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
        Policy memory p = mandate.getPolicy();
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

    function applyPolicy(uint256 waitFirst) external {
        _apply(mandate.POLICY_CHANGE(), waitFirst, 0);
    }

    // ---- asset rules

    function changeRule(uint256 assetSeed, uint256 seed) external {
        address asset = tokens[assetSeed % 3];
        seed = uint256(keccak256(abi.encode(seed)));
        AssetRule memory old = mandate.getRule(asset);
        AssetRule memory rule = AssetRule(old.allowed, old.defensive, old.maxExposureBps, old.stopPrice);
        (uint256 price,) = oracle.getPrice(asset);
        uint256 r = seed >> 8;
        if (seed % 5 == 0) rule.maxExposureBps = uint16(bound(r, old.maxExposureBps, 10_000));
        else if (seed % 5 == 1) rule.maxExposureBps = uint16(bound(r, 1_000, 10_000));
        else if (seed % 5 == 2) rule.stopPrice = bound(r, 0, price);
        else if (seed % 5 == 3) rule.stopPrice = bound(r, old.stopPrice, old.stopPrice > price ? old.stopPrice : price);
        else rule.defensive = !old.defensive;
        _proposeRule(asset, rule);
    }

    /// Takes an asset out of the mandate (immediate) or asks to put one back
    /// (waits). Asking to put one back is three times as likely, so the run
    /// does not end up with nothing left to trade.
    function delistOrRelist(uint256 assetSeed, uint256 seed) external {
        address asset = tokens[assetSeed % 3];
        AssetRule memory old = mandate.getRule(asset);
        bool delist = uint256(keccak256(abi.encode(seed))) % 4 == 0;
        if (old.allowed != delist) return;
        _proposeRule(asset, AssetRule(!old.allowed, old.defensive, old.maxExposureBps, old.stopPrice));
    }

    function applyRule(uint256 assetSeed, uint256 waitFirst) external {
        _apply(mandate.ruleKey(tokens[assetSeed % 3]), waitFirst, 1);
    }

    /// A panicking owner tries to let the agent buy the token that is pumping.
    function tryToAllowTheMemeCoin() external {
        bytes32 key = mandate.ruleKey(tokens[3]);
        vm.prank(owner);
        try mandate.proposeAssetRule(tokens[3], AssetRule(true, true, 10_000, 0)) {} catch {}
        if (mandate.getRule(tokens[3]).allowed) loosenedInstantly = true;
        // the guardian always vetoes this one, so the token stays off the allowlist for the whole run
        vm.prank(guardian);
        try mandate.cancelChange(key) {
            vetoed++;
        } catch {}
    }

    // ---- the stop-loss

    /// "Don't sell, it will come back": the owner tries to switch the stop-loss off.
    function ownerTriesToHaltTheStopLoss() external {
        uint64 before = mandate.stopLossHaltedUntil();
        vm.prank(owner);
        mandate.haltStopLoss();
        if (mandate.stopLossHaltedUntil() != before) loosenedInstantly = true;
        queued++;
    }

    function applyHalt(uint256 waitFirst) external {
        _apply(mandate.HALT_CHANGE(), waitFirst, 2);
    }

    /// The guardian's emergency halt, or either of them switching the stop-loss back on.
    function guardianHaltsOrSomeoneResumes(uint256 seed) external {
        seed = uint256(keccak256(abi.encode(seed)));
        if (seed % 4 == 0) {
            vm.prank(guardian);
            mandate.haltStopLoss();
            if (mandate.stopLossHaltedUntil() != block.timestamp + 3 days) tighteningDelayed = true;
        } else {
            vm.prank(seed % 2 == 0 ? owner : guardian);
            mandate.resumeStopLoss();
            // switching protection back on lowers risk, so it must be immediate
            if (mandate.stopLossHaltedUntil() != 0) tighteningDelayed = true;
            tightened++;
        }
    }

    // ---- the withdrawal address

    /// "Update your withdrawal address": the owner asks to send withdrawals somewhere else.
    function askToMoveTheWithdrawalAddress(bool back) external {
        address before = mandate.withdrawalAddress();
        vm.prank(owner);
        mandate.proposeWithdrawalAddress(back ? owner : secondAccount);
        if (mandate.withdrawalAddress() != before) loosenedInstantly = true;
        queued++;
    }

    function applyWithdrawalAddress(uint256 waitFirst) external {
        _apply(mandate.WITHDRAWAL_CHANGE(), waitFirst, 3);
    }

    // ---- the agent's key

    /// A longer life for the agent's key waits. A shorter one applies at once.
    function changeAgentExpiry(uint256 seed) external {
        if (mandate.agent() != agent) return;
        uint64 old = mandate.agentExpiry();
        uint64 expiry = uint64(bound(seed, block.timestamp + 1 hours, block.timestamp + 90 days));
        vm.prank(owner);
        try mandate.setAgent(agent, expiry) {} catch {
            return;
        }
        if (expiry <= old) {
            if (mandate.agentExpiry() != expiry) tighteningDelayed = true;
            tightened++;
        } else {
            if (mandate.agentExpiry() != old) loosenedInstantly = true;
            queued++;
        }
    }

    function applyAgent(uint256 waitFirst) external {
        _apply(mandate.AGENT_CHANGE(), waitFirst, 4);
    }

    /// The owner is talked into handing the agent role to someone else. It waits, and the guardian says no.
    function askForADifferentAgent() external {
        bytes32 key = mandate.AGENT_CHANGE();
        vm.prank(owner);
        try mandate.setAgent(secondAccount, uint64(block.timestamp + 30 days)) {} catch {
            return;
        }
        if (mandate.agent() == secondAccount) loosenedInstantly = true;
        vm.prank(guardian);
        mandate.cancelChange(key);
        vetoed++;
    }

    // ---- the guardian and the waiting period

    /// The owner asks to drop the guardian. It waits, the guardian cannot cancel
    /// it, and here the owner thinks better of it before the wait is over.
    function askToRemoveTheGuardian() external {
        bytes32 key = mandate.GUARDIAN_CHANGE();
        vm.prank(owner);
        mandate.setGuardian(address(0));
        if (mandate.guardian() != guardian) loosenedInstantly = true;
        vm.prank(guardian);
        try mandate.cancelChange(key) {
            guardianVetoedOwnRemoval = true;
        } catch {}
        vm.prank(owner);
        try mandate.cancelChange(key) {} catch {}
    }

    /// Leaving for a new vault is not a way around the wait: a second vault's
    /// first mandate cannot be signed at once, and the first one cannot be signed again.
    function tryANewVaultOrASecondSignature(bool again) external {
        address[] memory assets = new address[](1);
        assets[0] = tokens[0];
        AssetRule[] memory rules = new AssetRule[](1);
        rules[0] = AssetRule(true, true, 10_000, 0);
        Policy memory loose = Policy(10_000, type(uint16).max, 10_000, 500, 0, 0, 0);
        vm.startPrank(owner);
        if (again) {
            try mandate.signMandate(loose, assets, rules, agent, uint64(block.timestamp + 1 days)) {
                signedTwice = true;
            } catch {}
        } else {
            (Mandate another,) = factory.createVault(address(0), 1 minutes);
            try another.signMandate(loose, assets, rules, agent, uint64(block.timestamp + 1 days)) {
                newVaultSignedEarly = true;
            } catch {}
        }
        vm.stopPrank();
    }

    function changeWaitingPeriod(uint256 seed) external {
        uint64 old = mandate.loosenDelay();
        uint64 next = uint64(bound(uint256(keccak256(abi.encode(seed))), 1 minutes, 36 hours));
        vm.prank(owner);
        mandate.setLoosenDelay(next);
        if (next >= old) {
            if (mandate.loosenDelay() != next) tighteningDelayed = true;
            tightened++;
        } else {
            if (mandate.loosenDelay() != old) loosenedInstantly = true;
            queued++;
        }
    }

    function applyWaitingPeriod(uint256 waitFirst) external {
        _apply(mandate.DELAY_CHANGE(), waitFirst, 5);
    }

    // ---- pausing

    /// Mostly unpauses, so the run spends most of its time with a live agent.
    function pauseOrUnpause(uint256 seed) external {
        seed = uint256(keccak256(abi.encode(seed)));
        if (seed % 6 == 0) {
            bool byGuardian = seed % 12 == 0;
            vm.prank(byGuardian ? guardian : owner);
            mandate.pause();
            if (byGuardian) guardianHoldsThePause = true;
            // pausing lowers risk, so it must be immediate for either of them
            if (!mandate.paused()) tighteningDelayed = true;
            tightened++;
        } else if (seed % 2 == 0) {
            vm.prank(guardian);
            mandate.unpause();
            guardianHoldsThePause = false;
            if (mandate.paused()) tighteningDelayed = true;
        } else {
            vm.prank(owner);
            mandate.unpause();
            // the owner lifts their own pause at once, never the guardian's
            if (guardianHoldsThePause && !mandate.paused()) loosenedInstantly = true;
            if (!guardianHoldsThePause && mandate.paused()) tighteningDelayed = true;
        }
    }

    function applyUnpause(uint256 waitFirst) external {
        _apply(mandate.UNPAUSE_CHANGE(), waitFirst, 6);
    }

    function guardianVetoes(uint256 seed) external {
        bytes32[8] memory keys = [
            mandate.POLICY_CHANGE(),
            mandate.HALT_CHANGE(),
            mandate.WITHDRAWAL_CHANGE(),
            mandate.DELAY_CHANGE(),
            mandate.UNPAUSE_CHANGE(),
            mandate.commitmentKey(1),
            mandate.releaseKey(1),
            mandate.releaseKey(2)
        ];
        vm.prank(guardian);
        try mandate.cancelChange(keys[seed % 8]) {
            vetoed++;
        } catch {}
    }

    // ---- commitments: rent (1) and a reserve with no payee (2)

    /// Setting money aside lowers risk, so it must apply at once.
    function setAside(uint256 id, uint256 amount) external {
        id = 1 + id % 2;
        uint256 free = vault.holdings(address(usd)) - vault.reservedTotal();
        if (free < 2 || !mandate.getCommitment(id).active) return;
        amount = bound(amount, 1, free / 2);
        uint256 before = vault.reserved(id);
        vm.prank(owner);
        try vault.reserve(id, amount) {
            if (vault.reserved(id) != before + amount) tighteningDelayed = true;
            tightened++;
        } catch {}
    }

    /// Moving it back into investing raises risk, so it must only be queued.
    function askToRelease(uint256 id, uint256 amount) external {
        id = 1 + id % 2;
        uint256 held = vault.reserved(id);
        if (held == 0) return;
        amount = bound(amount, 1, held);
        uint256 before = vault.reservedTotal();
        vm.prank(owner);
        try vault.proposeRelease(id, amount) {
            if (vault.reservedTotal() != before) loosenedInstantly = true;
            queued++;
        } catch {}
    }

    function applyRelease(uint256 id, uint256 waitFirst) external {
        id = 1 + id % 2;
        _apply(mandate.releaseKey(id), waitFirst, 7 + id);
    }

    /// Changes the rent's terms in a random direction and checks the change was classified right.
    function changeRent(uint256 seed) external {
        seed = uint256(keccak256(abi.encode(seed)));
        // two separate reads: assigning one memory struct to another would alias them
        Commitment memory old = mandate.getCommitment(1);
        Commitment memory c = mandate.getCommitment(1);
        uint256 r = seed >> 8;
        uint256 field = seed % 9;
        if (field == 0) c.maxAmount = uint96(bound(r, old.maxAmount, 2 * old.maxAmount + 1));
        else if (field == 1) c.maxAmount = uint96(bound(r, 1, old.maxAmount));
        else if (field == 2) c.period = uint32(bound(r, old.window, old.period));
        else if (field == 3) c.period = uint32(bound(r, old.period, 60 days));
        else if (field == 4) c.window = uint32(bound(r, old.window, old.period));
        else if (field == 5) c.window = uint32(bound(r, 1 hours, old.window));
        else if (field == 6) c.nextDue = uint64(bound(r, block.timestamp, old.nextDue));
        else if (field == 7) c.nextDue = uint64(bound(r, old.nextDue, old.nextDue + 30 days));
        else c.active = !old.active;
        // our own reading of the table, not the contract's
        bool lowersRisk = !c.active
            || (old.active && c.payee == old.payee && c.maxAmount <= old.maxAmount && c.period >= old.period
                && c.window <= old.window && c.nextDue >= old.nextDue);
        vm.prank(owner);
        try mandate.proposeCommitment(1, c) {} catch {
            return;
        }
        bytes32 now_ = keccak256(abi.encode(mandate.getCommitment(1)));
        if (lowersRisk) {
            if (now_ != keccak256(abi.encode(c))) tighteningDelayed = true;
            tightened++;
        } else {
            if (now_ != keccak256(abi.encode(old))) loosenedInstantly = true;
            queued++;
        }
    }

    function applyRent(uint256 waitFirst) external {
        _apply(mandate.commitmentKey(1), waitFirst, 7);
    }

    /// The owner pays the rent early. It must arrive, and count for the current due date.
    function payRentEarly(uint256 amount) external {
        Commitment memory c = mandate.getCommitment(1);
        uint256 held = vault.reserved(1);
        if (!c.active || held == 0) return;
        amount = bound(amount, 1, held < c.maxAmount ? held : c.maxAmount);
        uint256 before = usd.balanceOf(landlord);
        vm.prank(owner);
        try vault.payCommitment(1, amount, bytes32(0)) {
            paidByOwner += amount;
            if (usd.balanceOf(landlord) != before + amount) withdrawalMisdirected = true;
        } catch {}
    }

    // ---- approvals and funds

    /// The owner signs for one trade above the agent's limits. Sometimes the
    /// approval is malformed on purpose: too long-lived, or not valid yet.
    function signApproval(uint256 seed, uint256 amount) external {
        seed = uint256(keccak256(abi.encode(seed)));
        bool isBuy = seed % 3 != 0;
        // one time in eight it is for the token that is not in the mandate
        address asset = (seed >> 8) % 8 == 0 ? tokens[3] : tokens[(seed >> 8) % 3];
        uint64 lifetime = (seed >> 16) % 5 == 0 ? uint64(bound(seed >> 24, 1 hours + 1, 2 days)) : uint64(bound(seed >> 24, 1 minutes, 1 hours));
        uint64 validFrom = (seed >> 40) % 7 == 0 ? uint64(block.timestamp + 30 minutes) : uint64(block.timestamp);
        _approval = PolicyVault.TradeApproval({
            action: isBuy ? 0 : 1,
            assetIn: isBuy ? address(usd) : asset,
            assetOut: isBuy ? asset : address(usd),
            amount: isBuy ? bound(amount, 1e6, 6_000e6) : bound(amount, 1e10, vault.holdings(asset) + 1e18),
            nonce: nextNonce++,
            validFrom: validFrom,
            expiry: validFrom + lifetime
        });
        // one time in six the owner's signature is for a different vault, which must make it worthless here
        approvalIsForTheDecoy = (seed >> 48) % 6 == 0;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, (approvalIsForTheDecoy ? decoy : vault).approvalDigest(_approval));
        _signature = abi.encodePacked(r, s, v);
        hasApproval = true;
    }

    function getApproval() external view returns (PolicyVault.TradeApproval memory, bytes memory) {
        return (_approval, _signature);
    }

    function cancelApproval() external {
        if (!hasApproval) return;
        vm.prank(owner);
        vault.cancelApproval(_approval.nonce);
    }

    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 5_000e6);
        usd.mint(owner, amount);
        vm.startPrank(owner);
        usd.approve(address(vault), amount);
        vault.deposit(address(usd), amount);
        vm.stopPrank();
    }

    /// Takes out part of a holding. It must arrive at the address registered in the mandate.
    function withdraw(uint256 tokenSeed, uint256 amount) external {
        address token = tokenSeed % 4 == 3 ? address(usd) : tokens[tokenSeed % 3];
        uint256 held = vault.holdings(token);
        if (held < 8) return;
        amount = bound(amount, 1, held / 4);
        address to = mandate.withdrawalAddress();
        uint256 before = IERC20(token).balanceOf(to);
        vm.prank(owner);
        vault.withdraw(token, amount);
        if (IERC20(token).balanceOf(to) != before + amount) withdrawalMisdirected = true;
    }

    /// Takes out everything, which must end the mandate, then comes back: a
    /// fresh deposit, and a new key for the agent that has to wait like any other.
    function leaveAndComeBack(uint256 seed) external {
        if (uint256(keccak256(abi.encode(seed))) % 6 != 0 || mandate.agent() != agent) return;
        vm.startPrank(owner);
        for (uint256 i = 0; i < 3; i++) {
            uint256 held = vault.holdings(tokens[i]);
            if (held != 0) vault.withdraw(tokens[i], held);
        }
        uint256 cash = vault.holdings(address(usd));
        if (cash != 0) vault.withdraw(address(usd), cash);
        if (mandate.agent() != address(0)) terminationMissed = true;

        usd.mint(owner, 10_000e6);
        usd.approve(address(vault), 10_000e6);
        vault.deposit(address(usd), 10_000e6);
        try mandate.setAgent(agent, uint64(block.timestamp + 60 days)) {} catch {}
        if (mandate.agent() != address(0)) loosenedInstantly = true;
        vm.stopPrank();
        _apply(mandate.AGENT_CHANGE(), 0, 4);
        if (mandate.agent() != agent) {
            // the guardian may have paused or the key proposal failed; wait it out properly
            uint64 eta = mandate.pendingEta(mandate.AGENT_CHANGE());
            if (eta != 0) {
                vm.warp(eta);
                vm.prank(owner);
                mandate.applyAgent();
            }
        }
    }

    // ---- internals

    function _propose(Policy memory p) internal {
        Policy memory old = mandate.getPolicy();
        bool streakOk = p.maxLossStreak == old.maxLossStreak
            || (p.maxLossStreak != 0 && (old.maxLossStreak == 0 || p.maxLossStreak < old.maxLossStreak));
        bool lowersRisk = streakOk && p.maxTradeBps <= old.maxTradeBps && p.maxDailyVolumeBps <= old.maxDailyVolumeBps
            && p.dailyLossBps <= old.dailyLossBps && p.maxSlippageBps <= old.maxSlippageBps
            && p.minDefensiveBps >= old.minDefensiveBps && p.cooldown >= old.cooldown;
        vm.prank(owner);
        try mandate.proposePolicy(p) {} catch {
            return;
        }
        bytes32 now_ = keccak256(abi.encode(mandate.getPolicy()));
        if (lowersRisk) {
            if (now_ != keccak256(abi.encode(p))) tighteningDelayed = true;
            tightened++;
        } else {
            if (now_ != keccak256(abi.encode(old))) loosenedInstantly = true;
            queued++;
        }
    }

    function _proposeRule(address asset, AssetRule memory rule) internal {
        AssetRule memory old = mandate.getRule(asset);
        bool lowersRisk = (!rule.allowed || old.allowed) && (!rule.defensive || old.defensive)
            && rule.maxExposureBps <= old.maxExposureBps && rule.stopPrice >= old.stopPrice;
        vm.prank(owner);
        try mandate.proposeAssetRule(asset, rule) {} catch {
            return;
        }
        bytes32 now_ = keccak256(abi.encode(mandate.getRule(asset)));
        if (lowersRisk) {
            if (now_ != keccak256(abi.encode(rule))) tighteningDelayed = true;
            tightened++;
        } else {
            if (now_ != keccak256(abi.encode(old))) loosenedInstantly = true;
            queued++;
        }
    }

    /// Tries to apply the change waiting under `key`. If it goes through, the wait must be over.
    /// @param waitFirst zero, or one other value in three, waits out the delay first, with the price keeper still running
    function _apply(bytes32 key, uint256 waitFirst, uint256 kind) internal {
        uint64 eta = mandate.pendingEta(key);
        if ((waitFirst == 0 || uint256(keccak256(abi.encode(waitFirst))) % 3 == 0) && eta > block.timestamp) {
            vm.warp(eta);
            vm.startPrank(updater);
            for (uint256 i = 0; i < tokens.length; i++) {
                (uint256 price,) = oracle.getPrice(tokens[i]);
                // a feed refreshed under a minute ago refuses another update, and does not need one
                try oracle.setPrice(tokens[i], price) {} catch {}
            }
            vm.stopPrank();
        }
        vm.startPrank(owner);
        bool ok;
        if (kind == 0) {
            try mandate.applyPolicy() {
                ok = true;
            } catch {}
        } else if (kind == 1) {
            try mandate.applyAssetRule(address(uint160(uint256(key)))) {
                ok = true;
            } catch {}
        } else if (kind == 2) {
            try mandate.applyStopLossHalt() {
                ok = true;
            } catch {}
        } else if (kind == 3) {
            try mandate.applyWithdrawalAddress() {
                ok = true;
            } catch {}
        } else if (kind == 4) {
            try mandate.applyAgent() {
                ok = true;
            } catch {}
        } else if (kind == 5) {
            try mandate.applyLoosenDelay() {
                ok = true;
            } catch {}
        } else if (kind == 6) {
            try mandate.applyUnpause() {
                ok = true;
            } catch {}
        } else if (kind == 7) {
            try mandate.applyCommitment(1) {
                ok = true;
            } catch {}
        } else {
            try vault.applyRelease(kind - 7) {
                ok = true;
            } catch {}
        }
        vm.stopPrank();
        if (ok) {
            applied++;
            if (eta == 0 || block.timestamp < eta) appliedEarly = true;
            if (kind == 6) guardianHoldsThePause = false;
        }
    }
}

/// Threat A. Plays a fully compromised agent: it holds the real agent key and
/// fires random calls at everything that key can reach. After every call that
/// goes through, it checks the result against the mandate and records any breach.
contract CompromisedAgent is Test {
    uint256 constant BPS = 10_000;

    Mandate public mandate;
    PolicyVault public vault;
    TestUSD public usd;
    PriceOracle public oracle;
    PanickingOwner public ownerHandler;
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
    bool public stopRefusedWrongly;
    bool public stopProceedsLeft;
    bool public rulesTouched;
    bool public approvalBroken;
    bool public setUpAgain;
    bool public paymentBroken;
    uint256 public paidByAgent;
    uint256 public paymentsMade;

    uint256 public attempts;
    uint256 public trades;
    uint256 public approvalsUsed;
    uint256 public approvalsRefused;
    uint256 public buysRefusedInProtectMode;
    uint256 public stopLossesFired;
    /// how often each contract error turned the agent away
    mapping(bytes4 => uint256) public refusals;
    mapping(uint256 => uint256) public volumeByDay;

    constructor(PanickingOwner ownerHandler_, address attacker_) {
        ownerHandler = ownerHandler_;
        mandate = ownerHandler_.mandate();
        vault = ownerHandler_.vault();
        usd = ownerHandler_.usd();
        oracle = ownerHandler_.oracle();
        agent = ownerHandler_.agent();
        attacker = attacker_;
        for (uint256 i = 0; i < 4; i++) {
            tokens.push(ownerHandler_.tokens(i));
        }
        // the fixture may have traded today; the vault's count only means today if its day is today
        if (block.timestamp / 1 days == vault.day()) volumeByDay[block.timestamp / 1 days] = vault.volumeToday();
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
        bool wasPaused = mandate.paused();
        uint256 valueBefore = vault.portfolioValue();
        attempts++;
        vm.prank(agent);
        try vault.rebalance(orders, bytes32(0)) {
            if (hasBuy && wasProtected) boughtWhileProtected = true;
            if (legTooBig) sizeBroken = true;
            for (uint256 i = 0; i < legs; i++) {
                if (orders[i].isBuy && !mandate.getRule(orders[i].asset).allowed) tradedOffAllowlist = true;
            }
            _afterTrade(volume, valueBefore, wasPaused);
        } catch {}
    }

    /// Uses the owner's latest signed approval: as signed, with one field
    /// changed, or again after it has been used. Only the first may work, once,
    /// inside its time window, and every rule but the two size limits still holds.
    /// The owner signs for a trade and the agent uses it straight away, as signed.
    function signAndUseApproval(uint256 seed, uint256 amount) external {
        ownerHandler.signApproval(seed, amount);
        _useApproval(0);
    }

    function useApproval(uint256 seed) external {
        _useApproval(uint256(keccak256(abi.encode(seed))));
    }

    function _useApproval(uint256 seed) internal {
        if (!ownerHandler.hasApproval()) return;
        (PolicyVault.TradeApproval memory a, bytes memory sig) = ownerHandler.getApproval();
        bytes32 signed = keccak256(abi.encode(a));
        if (seed % 5 == 1) a.amount += 1 + (seed >> 8) % 1e9;
        else if (seed % 5 == 2) a.nonce += 1;
        else if (seed % 5 == 3) a.expiry += 1 hours;
        else if (seed % 5 == 4 && a.action == 0) a.assetOut = tokens[(seed >> 8) % tokens.length];

        bool tampered = keccak256(abi.encode(a)) != signed || ownerHandler.approvalIsForTheDecoy();
        bool usedBefore = vault.usedNonce(a.nonce);
        bool inWindow = block.timestamp >= a.validFrom && block.timestamp <= a.expiry && a.expiry - a.validFrom <= 1 hours;
        address bought = a.action == 0 ? a.assetOut : address(0);
        bool belowStop;
        if (bought != address(0)) {
            (uint256 price,) = oracle.getPrice(bought);
            belowStop = price <= mandate.getRule(bought).stopPrice;
        }
        bool wasProtected = vault.inProtectMode();
        bool wasPaused = mandate.paused();
        uint256 valueBefore = vault.portfolioValue();
        uint256 usdValue = a.action == 0 ? a.amount : _usdValue(a.assetIn, a.amount);

        vm.prank(agent);
        try vault.tradeWithApproval(a, sig, bytes32(0)) {
            approvalsUsed++;
            if (tampered || usedBefore || !inWindow || !vault.usedNonce(a.nonce)) approvalBroken = true;
            if (wasPaused) tradedWhilePaused = true;
            if (bought != address(0)) {
                if (wasProtected) boughtWhileProtected = true;
                if (belowStop) boughtBelowStop = true;
                _checkHolding(bought);
            }
            // an approved trade is outside the agent's own allowance, so the day's count must not move
            if (vault.volumeToday() != volumeByDay[block.timestamp / 1 days]) volumeBroken = true;
            _checkCost(usdValue, valueBefore);
        } catch {
            approvalsRefused++;
        }
    }

    /// Pays a commitment, including the reserve with no payee and one that does
    /// not exist, at a random amount. Anything that goes through must be inside
    /// the commitment's terms and move its due date on.
    function payCommitment(uint256 id, uint256 amount) external {
        id = 1 + id % 3;
        Commitment memory c = mandate.getCommitment(id);
        uint256 held = vault.reserved(id);
        // half the time a plausible amount, so payments that go through get checked too
        amount = amount % 2 == 0 && c.maxAmount != 0 ? bound(amount, 1, c.maxAmount) : bound(amount, 0, 2 * uint256(c.maxAmount) + 1_000e6);
        uint256 before = c.payee == address(0) ? 0 : usd.balanceOf(c.payee);
        bool wasPaused = mandate.paused();
        attempts++;
        vm.prank(agent);
        try vault.payCommitment(id, amount, bytes32(0)) {
            paymentsMade++;
            paidByAgent += amount;
            if (!c.active || c.payee == address(0) || amount == 0 || amount > c.maxAmount || amount > held) paymentBroken = true;
            if (block.timestamp + c.window < c.nextDue || wasPaused) paymentBroken = true;
            if (usd.balanceOf(c.payee) != before + amount) paymentBroken = true;
            Commitment memory next = mandate.getCommitment(id);
            if (c.period == 0 ? next.active : next.nextDue != c.nextDue + c.period) paymentBroken = true;
        } catch (bytes memory err) {
            refusals[bytes4(err)]++;
        }
    }

    /// Everything the agent key must not be able to do, in one go.
    function callOwnerFunctions(uint256 amount, uint256 assetSeed) external {
        address asset = tokens[assetSeed % tokens.length];
        Policy memory loose = Policy(10_000, type(uint16).max, 10_000, 500, 0, 0, 0);
        AssetRule memory open = AssetRule(true, true, 10_000, 0);
        address[] memory assets = new address[](1);
        assets[0] = asset;
        AssetRule[] memory rules = new AssetRule[](1);
        rules[0] = open;
        bytes32[10] memory keys = [
            mandate.POLICY_CHANGE(),
            mandate.HALT_CHANGE(),
            mandate.WITHDRAWAL_CHANGE(),
            mandate.AGENT_CHANGE(),
            mandate.GUARDIAN_CHANGE(),
            mandate.DELAY_CHANGE(),
            mandate.UNPAUSE_CHANGE(),
            mandate.ruleKey(asset),
            mandate.commitmentKey(1),
            mandate.releaseKey(1)
        ];
        Commitment memory toAttacker = Commitment(attacker, type(uint96).max, 1 hours, 1 hours, uint64(block.timestamp), true);

        bytes32 before = _rulesHash();
        uint256 usdBefore = usd.balanceOf(address(vault));
        vm.startPrank(agent);
        try vault.withdraw(address(usd), amount) {} catch {}
        try vault.withdraw(asset, amount) {} catch {}
        try vault.sweep(address(usd)) {} catch {}
        try vault.deposit(address(usd), amount) {} catch {}
        try vault.cancelApproval(amount) {} catch {}
        try mandate.signMandate(loose, assets, rules, attacker, uint64(block.timestamp + 1 days)) {} catch {}
        try mandate.proposePolicy(loose) {} catch {}
        try mandate.applyPolicy() {} catch {}
        try mandate.proposeAssetRule(asset, open) {} catch {}
        try mandate.applyAssetRule(asset) {} catch {}
        try mandate.proposeWithdrawalAddress(attacker) {} catch {}
        try mandate.applyWithdrawalAddress() {} catch {}
        try mandate.haltStopLoss() {} catch {}
        try mandate.applyStopLossHalt() {} catch {}
        try mandate.resumeStopLoss() {} catch {}
        try mandate.setAgent(attacker, uint64(block.timestamp + 90 days)) {} catch {}
        try mandate.applyAgent() {} catch {}
        try mandate.revokeAgent() {} catch {}
        try mandate.setGuardian(agent) {} catch {}
        try mandate.applyGuardian() {} catch {}
        try mandate.setLoosenDelay(1 minutes) {} catch {}
        try mandate.applyLoosenDelay() {} catch {}
        try mandate.applyUnpause() {} catch {}
        try mandate.terminate() {} catch {}
        try mandate.proposeCommitment(1, toAttacker) {} catch {}
        try mandate.proposeCommitment(3, toAttacker) {} catch {}
        try mandate.applyCommitment(1) {} catch {}
        try mandate.queueRelease(1) {} catch {}
        try mandate.takeRelease(1) {} catch {}
        try mandate.markPaid(1) {} catch {}
        try vault.reserve(1, amount) {} catch {}
        try vault.proposeRelease(1, amount) {} catch {}
        try vault.applyRelease(1) {} catch {}
        for (uint256 i = 0; i < keys.length; i++) {
            try mandate.cancelChange(keys[i]) {} catch {}
        }
        try mandate.pause() {} catch {}
        try mandate.unpause() {} catch {}
        // and straight at the tokens
        try usd.transferFrom(address(vault), agent, amount) {} catch {}
        try IERC20(asset).transferFrom(address(vault), agent, amount) {} catch {}
        vm.stopPrank();
        if (_rulesHash() != before || usd.balanceOf(address(vault)) != usdBefore) rulesTouched = true;
    }

    /// The vault and the mandate are copies of templates. Nobody may set a copy up a second time.
    function setUpACopyAgain(bool asAgent) external {
        vm.startPrank(asAgent ? agent : attacker);
        try mandate.init(attacker, address(0), attacker, address(usd), oracle, 1 minutes, 0) {
            setUpAgain = true;
        } catch {}
        try vault.init(Mandate(attacker), usd, oracle, vault.exchange(), 1) {
            setUpAgain = true;
        } catch {}
        vm.stopPrank();
    }

    /// Anyone can call the stop-loss. It must only fire at or below the stop
    /// price, never during a halt, it must sell the whole holding, and every
    /// unit of the proceeds must stay in the vault.
    function triggerStopLoss(uint256 assetSeed) external {
        address asset = tokens[assetSeed % tokens.length];
        (uint256 price, uint256 updatedAt) = oracle.getPrice(asset);
        uint256 stopPrice = mandate.getRule(asset).stopPrice;
        bool halted = block.timestamp < mandate.stopLossHaltedUntil();
        // when all of this holds, nothing else may stand in the way, not even a paused agent
        bool due = vault.holdings(asset) != 0 && price <= stopPrice && !halted && block.timestamp <= updatedAt + vault.maxPriceAge();
        uint256 cashBefore = vault.holdings(address(usd));
        uint256 balanceBefore = usd.balanceOf(address(vault));
        vm.prank(attacker);
        try vault.triggerStopLoss(asset) returns (uint256 usdOut) {
            stopLossesFired++;
            if (price > stopPrice || halted || vault.holdings(asset) != 0) stopFiredEarly = true;
            if (vault.holdings(address(usd)) != cashBefore + usdOut || usd.balanceOf(address(vault)) != balanceBefore + usdOut) {
                stopProceedsLeft = true;
            }
        } catch {
            if (due) stopRefusedWrongly = true;
        }
    }

    function poke() external {
        vm.prank(attacker);
        try vault.poke() {} catch {}
    }

    /// Free test dollars sent straight to the vault must not shift any check.
    function donate(uint256 amount) external {
        uint256 valueBefore = vault.portfolioValue();
        usd.mint(address(vault), bound(amount, 1, 1_000_000e6));
        if (vault.portfolioValue() != valueBefore) rulesTouched = true;
    }

    function _tryBuy(address asset, uint256 amount) internal {
        (uint256 price,) = oracle.getPrice(asset);
        bool belowStop = price <= mandate.getRule(asset).stopPrice;
        bool wasProtected = vault.inProtectMode();
        bool wasPaused = mandate.paused();
        uint256 limit = _tradeLimit();
        uint256 valueBefore = vault.portfolioValue();
        attempts++;
        vm.prank(agent);
        try vault.buy(asset, amount, bytes32(0)) {
            if (wasProtected) boughtWhileProtected = true;
            if (belowStop) boughtBelowStop = true;
            if (amount > limit) sizeBroken = true;
            _checkHolding(asset);
            _afterTrade(amount, valueBefore, wasPaused);
        } catch (bytes memory err) {
            refusals[bytes4(err)]++;
            if (wasProtected) buysRefusedInProtectMode++;
        }
    }

    function _trySell(address asset, uint256 amount) internal {
        bool wasPaused = mandate.paused();
        uint256 limit = _tradeLimit();
        uint256 valueBefore = vault.portfolioValue();
        uint256 value = _usdValue(asset, amount);
        attempts++;
        vm.prank(agent);
        try vault.sell(asset, amount, bytes32(0)) {
            if (value > limit) sizeBroken = true;
            // a full streak must have been turned into a cooldown and reset
            uint8 maxStreak = mandate.getPolicy().maxLossStreak;
            if (maxStreak != 0 && vault.lossStreak() >= maxStreak) streakBroken = true;
            _afterTrade(value, valueBefore, wasPaused);
        } catch (bytes memory err) {
            refusals[bytes4(err)]++;
        }
    }

    /// After a buy: the asset is in the mandate, inside its cap, and enough is left in defensive assets.
    function _checkHolding(address asset) internal {
        AssetRule memory rule = mandate.getRule(asset);
        if (!rule.allowed) tradedOffAllowlist = true;
        if (vault.exposureBps(asset) > rule.maxExposureBps) exposureBroken = true;
        if (!rule.defensive && vault.defensiveBps() < mandate.getPolicy().minDefensiveBps) floorBroken = true;
    }

    function _afterTrade(uint256 usdValue, uint256 valueBefore, bool wasPaused) internal {
        trades++;
        if (wasPaused) tradedWhilePaused = true;
        // the vault's count of today's agent volume must match ours and be inside the cap
        uint256 today = block.timestamp / 1 days;
        volumeByDay[today] += usdValue;
        if (volumeByDay[today] != vault.volumeToday()) volumeBroken = true;
        if (vault.volumeToday() > vault.dayStartValue() * mandate.getPolicy().maxDailyVolumeBps / BPS) volumeBroken = true;
        _checkCost(usdValue, valueBefore);
    }

    function _checkCost(uint256 usdValue, uint256 valueBefore) internal {
        uint256 valueAfter = vault.portfolioValue();
        // prices did not move inside this call, so any drop in value is what the trade cost
        if (valueBefore > valueAfter && valueBefore - valueAfter > usdValue * mandate.getPolicy().maxSlippageBps / BPS + 4) {
            costBroken = true;
        }
    }

    function _tradeLimit() internal view returns (uint256) {
        return vault.portfolioValue() * mandate.getPolicy().maxTradeBps / BPS;
    }

    function _usdValue(address asset, uint256 amount) internal view returns (uint256) {
        (uint256 price,) = oracle.getPrice(asset);
        return amount * price / 1e20;
    }

    /// Everything the agent must not be able to change.
    function _rulesHash() internal view returns (bytes32 h) {
        h = keccak256(
            abi.encode(
                mandate.getPolicy(),
                mandate.getPendingPolicy(),
                mandate.agent(),
                mandate.agentExpiry(),
                mandate.guardian(),
                mandate.paused(),
                mandate.pausedByGuardian(),
                mandate.withdrawalAddress(),
                mandate.stopLossHaltedUntil(),
                mandate.loosenDelay(),
                mandate.signed(),
                mandate.getAssets()
            )
        );
        h = keccak256(
            abi.encode(
                h,
                mandate.pendingEta(mandate.POLICY_CHANGE()),
                mandate.pendingEta(mandate.HALT_CHANGE()),
                mandate.pendingEta(mandate.WITHDRAWAL_CHANGE()),
                mandate.pendingEta(mandate.AGENT_CHANGE()),
                mandate.pendingEta(mandate.GUARDIAN_CHANGE()),
                mandate.pendingEta(mandate.DELAY_CHANGE()),
                mandate.pendingEta(mandate.UNPAUSE_CHANGE()),
                address(vault.mandate()),
                mandate.vault(),
                mandate.owner()
            )
        );
        for (uint256 i = 0; i < tokens.length; i++) {
            h = keccak256(
                abi.encode(h, mandate.getRule(tokens[i]), mandate.getPendingRule(tokens[i]), mandate.pendingEta(mandate.ruleKey(tokens[i])))
            );
        }
        for (uint256 id = 1; id <= 3; id++) {
            h = keccak256(
                abi.encode(
                    h,
                    mandate.getCommitment(id),
                    mandate.getPendingCommitment(id),
                    mandate.pendingEta(mandate.commitmentKey(id)),
                    mandate.pendingEta(mandate.releaseKey(id)),
                    vault.reserved(id),
                    vault.pendingRelease(id)
                )
            );
        }
        h = keccak256(abi.encode(h, mandate.commitmentCount(), vault.reservedTotal()));
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

    /// Days pass, with the price keeper running, so due dates come round.
    function waitDays(uint256 days_) external {
        vm.warp(block.timestamp + bound(days_, 1 days, 8 days));
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
        mandate.proposeAssetRule(address(idx), AssetRule(true, false, 5000, 85 * PRICE));

        // rent due weekly, the first due date already inside its window once set up, and a reserve with nobody to pay
        vm.startPrank(owner);
        mandate.proposeCommitment(1, Commitment(makeAddr("landlord"), 500e6, 7 days, 2 days, uint64(block.timestamp + 1 days), true));
        mandate.proposeCommitment(2, Commitment(address(0), 0, 0, 0, 0, true));
        vm.stopPrank();
        skip(LOOSEN_DELAY);
        _refreshPrices();
        vm.startPrank(owner);
        mandate.applyCommitment(1);
        vault.reserve(1, 1_000e6);
        vault.reserve(2, 500e6);
        vm.stopPrank();

        vm.prank(stranger);
        (, PolicyVault decoy) = factory.createVault(address(0), LOOSEN_DELAY);
        ownerHandler = new PanickingOwner(mandate, vault, usd, oracle, OWNER_KEY, guardian, agent, updater, tokens, factory, decoy);
        agentHandler = new CompromisedAgent(ownerHandler, attacker);
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
    /// the owner registered for withdrawals. Stop-loss proceeds stay in the vault.
    function invariant_FundsOnlyLeaveToTheWithdrawalAddress() public view {
        address second = ownerHandler.secondAccount();
        assertEq(
            usd.totalSupply(),
            usd.balanceOf(address(vault)) + usd.balanceOf(address(exchange)) + usd.balanceOf(owner)
                + usd.balanceOf(second) + usd.balanceOf(ownerHandler.landlord())
        );
        for (uint256 i = 0; i < 3; i++) {
            MockAsset a = MockAsset(tokens[i]);
            assertEq(a.totalSupply(), a.balanceOf(address(vault)) + a.balanceOf(owner) + a.balanceOf(second));
        }
        assertEq(usd.balanceOf(agent) + usd.balanceOf(attacker) + usd.balanceOf(address(agentHandler)), 0);
        assertFalse(agentHandler.stopProceedsLeft());
    }

    /// The token off the allowlist is never bought, by any route.
    function invariant_NeverHoldsAnAssetOffTheAllowlist() public view {
        assertEq(meme.totalSupply(), 0);
        assertEq(vault.holdings(address(meme)), 0);
        assertFalse(mandate.getRule(address(meme)).allowed);
        assertFalse(agentHandler.tradedOffAllowlist());
    }

    /// After any agent buy, signed for by the owner or not, the asset is inside
    /// its exposure cap and enough is left in cash and defensive assets.
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

    /// The agent key can never withdraw, change the mandate or the keys, pause
    /// or unpause, halt the stop-loss or move the withdrawal address, and
    /// tokens sent to the vault do not move its valuation.
    function invariant_AgentCannotChangeTheRules() public view {
        assertFalse(agentHandler.rulesTouched());
        assertEq(mandate.agent(), agent);
        assertEq(mandate.guardian(), guardian);
        assertEq(mandate.owner(), owner);
    }

    /// Threat B. Nothing that raises the risk takes effect before its waiting
    /// period: a looser mandate or asset rule, an owner's halt of the
    /// stop-loss, a new withdrawal address, a longer-lived or different agent
    /// key, a shorter waiting period, lifting a guardian's pause, dropping the guardian.
    function invariant_RiskOnlyGoesUpAfterTheDelay() public view {
        assertFalse(ownerHandler.loosenedInstantly());
        assertFalse(ownerHandler.appliedEarly());
        assertFalse(ownerHandler.guardianVetoedOwnRemoval());
        assertFalse(ownerHandler.newVaultSignedEarly());
        assertFalse(ownerHandler.signedTwice());
    }

    /// The owner can always take funds out, they arrive at the registered
    /// address, and taking out everything ends the mandate.
    function invariant_WithdrawalsGoToTheRegisteredAddress() public view {
        assertFalse(ownerHandler.withdrawalMisdirected());
        assertFalse(ownerHandler.terminationMissed());
    }

    /// Every change that lowers the risk takes effect in the same transaction.
    function invariant_RiskGoesDownImmediately() public view {
        assertFalse(ownerHandler.tighteningDelayed());
    }

    /// A signed approval works once, only exactly as signed, only inside its
    /// time window of an hour at most, and lifts nothing but the two size limits.
    function invariant_ApprovalsWorkOnceAndOnlyAsSigned() public view {
        assertFalse(agentHandler.approvalBroken());
    }

    /// The stop-loss only fires at or below the stop price and outside a halt,
    /// and sells the whole holding.
    function invariant_StopLossOnlyFiresAtTheStopPrice() public view {
        assertFalse(agentHandler.stopFiredEarly());
        // and when it is due it always fires, whether or not the agent is paused
        assertFalse(agentHandler.stopRefusedWrongly());
    }

    /// A vault and its mandate are bound to each other for good, and neither copy can be set up twice.
    function invariant_CopiesAreBoundOnceAndForGood() public view {
        assertFalse(agentHandler.setUpAgain());
        assertEq(address(vault.mandate()), address(mandate));
        assertEq(mandate.vault(), address(vault));
    }

    /// Money set aside adds up, is backed, and is never part of what the agent trades.
    function invariant_ReservesAreBackedAndAddUp() public view {
        assertEq(vault.reservedTotal(), vault.reserved(1) + vault.reserved(2) + vault.reserved(3));
        assertLe(vault.reservedTotal(), vault.holdings(address(usd)));
    }

    /// The payee receives exactly what was paid on purpose, and every agent
    /// payment was inside its commitment's terms: right payee, amount, reserve,
    /// due window, once per due date, never while paused.
    function invariant_CommitmentsArePaidOnlyOnTheirTerms() public view {
        assertFalse(agentHandler.paymentBroken());
        assertEq(usd.balanceOf(ownerHandler.landlord()), agentHandler.paidByAgent() + ownerHandler.paidByOwner());
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
        console.log("approvals used", agentHandler.approvalsUsed(), "refused", agentHandler.approvalsRefused());
        console.log("risk increases queued", ownerHandler.queued(), "applied after the wait", ownerHandler.applied());
        console.log("risk cuts applied at once", ownerHandler.tightened(), "guardian vetoes", ownerHandler.vetoed());
        console.log("buys refused in protect mode", agentHandler.buysRefusedInProtectMode());
        console.log("stop-losses fired", agentHandler.stopLossesFired());
        console.log("commitment payments by the agent", agentHandler.paymentsMade());
        _logRefusals("CommitmentNotDue", PolicyVault.CommitmentNotDue.selector);
        _logRefusals("ExceedsCommitmentAmount", PolicyVault.ExceedsCommitmentAmount.selector);
        _logRefusals("ExceedsReserve", PolicyVault.ExceedsReserve.selector);
        _logRefusals("CommitmentNotPayable", PolicyVault.CommitmentNotPayable.selector);
        _logRefusals("AssetNotAllowed", PolicyVault.AssetNotAllowed.selector);
        _logRefusals("ExceedsTradeLimit", PolicyVault.ExceedsTradeLimit.selector);
        _logRefusals("ExceedsDailyVolume", PolicyVault.ExceedsDailyVolume.selector);
        _logRefusals("ExceedsExposure", PolicyVault.ExceedsExposure.selector);
        _logRefusals("BelowDefensiveFloor", PolicyVault.BelowDefensiveFloor.selector);
        _logRefusals("ExceedsDailyLoss", PolicyVault.ExceedsDailyLoss.selector);
        _logRefusals("CooldownActive", PolicyVault.CooldownActive.selector);
        _logRefusals("BelowStopPrice", PolicyVault.BelowStopPrice.selector);
        _logRefusals("StalePrice", PolicyVault.StalePrice.selector);
        _logRefusals("AgentPaused", Mandate.AgentPaused.selector);
        _logRefusals("AgentKeyExpired", Mandate.AgentKeyExpired.selector);
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
        vm.warp(mandate.agentExpiry());
        market.wait(0);
        for (uint256 i = 0; i < 3; i++) {
            held[i] = vault.holdings(tokens[i]);
        }
    }

    /// The key makes no trade, with or without an approval. Holdings can still
    /// fall, because the stop-loss does not need the agent, but nothing is ever bought.
    function invariant_ExpiredKeyCanDoNothing() public view {
        assertEq(agentHandler.trades() + agentHandler.approvalsUsed(), 0);
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
        mandate.revokeAgent();
    }

    function invariant_RevokedKeyCanDoNothing() public view {
        assertEq(agentHandler.trades() + agentHandler.approvalsUsed(), 0);
        assertEq(mandate.agent(), address(0));
    }
}

/// Commitments only: the owner sets money aside, asks to release it, changes
/// the rent and pays early; the trusted contact vetoes; the compromised agent
/// fires payments and owner calls; time passes. Every run spends its calls here.
contract CommitmentsInvariantTest is InvariantFixture {
    function setUp() public override {
        super.setUp();
        bytes4[] memory agentCalls = new bytes4[](2);
        agentCalls[0] = CompromisedAgent.payCommitment.selector;
        agentCalls[1] = CompromisedAgent.callOwnerFunctions.selector;
        targetSelector(FuzzSelector({addr: address(agentHandler), selectors: agentCalls}));

        bytes4[] memory ownerCalls = new bytes4[](8);
        ownerCalls[0] = PanickingOwner.setAside.selector;
        ownerCalls[1] = PanickingOwner.askToRelease.selector;
        ownerCalls[2] = PanickingOwner.applyRelease.selector;
        ownerCalls[3] = PanickingOwner.changeRent.selector;
        ownerCalls[4] = PanickingOwner.applyRent.selector;
        ownerCalls[5] = PanickingOwner.payRentEarly.selector;
        ownerCalls[6] = PanickingOwner.guardianVetoes.selector;
        ownerCalls[7] = PanickingOwner.withdraw.selector;
        targetContract(address(ownerHandler));
        targetSelector(FuzzSelector({addr: address(ownerHandler), selectors: ownerCalls}));

        bytes4[] memory marketCalls = new bytes4[](2);
        marketCalls[0] = MarketMoves.wait.selector;
        marketCalls[1] = MarketMoves.waitDays.selector;
        targetSelector(FuzzSelector({addr: address(market), selectors: marketCalls}));
    }

    function invariant_ReservesAreBackedAndAddUp() public view {
        assertEq(vault.reservedTotal(), vault.reserved(1) + vault.reserved(2) + vault.reserved(3));
        assertLe(vault.reservedTotal(), vault.holdings(address(usd)));
    }

    function invariant_CommitmentsArePaidOnlyOnTheirTerms() public view {
        assertFalse(agentHandler.paymentBroken());
        assertEq(usd.balanceOf(ownerHandler.landlord()), agentHandler.paidByAgent() + ownerHandler.paidByOwner());
    }

    function invariant_ReleasesAndNewTermsWait_CutsDoNot() public view {
        assertFalse(ownerHandler.loosenedInstantly());
        assertFalse(ownerHandler.appliedEarly());
        assertFalse(ownerHandler.tighteningDelayed());
    }

    function invariant_AgentCannotTouchCommitmentsOrReserves() public view {
        assertFalse(agentHandler.rulesTouched());
        assertFalse(ownerHandler.withdrawalMisdirected());
    }

    function afterInvariant() public view {
        console.log("commitment payments by the agent", agentHandler.paymentsMade(), "of", agentHandler.attempts());
        console.log("owner paid", ownerHandler.paidByOwner(), "agent paid", agentHandler.paidByAgent());
        console.log("queued", ownerHandler.queued(), "applied after the wait", ownerHandler.applied());
        console.log("cuts at once", ownerHandler.tightened(), "vetoes", ownerHandler.vetoed());
        console.log("  not due", agentHandler.refusals(PolicyVault.CommitmentNotDue.selector));
        console.log("  over amount", agentHandler.refusals(PolicyVault.ExceedsCommitmentAmount.selector));
        console.log("  over reserve", agentHandler.refusals(PolicyVault.ExceedsReserve.selector));
        console.log("  not payable", agentHandler.refusals(PolicyVault.CommitmentNotPayable.selector));
        console.log("  zero", agentHandler.refusals(PolicyVault.ZeroAmount.selector));
        console.log("  not agent", agentHandler.refusals(Mandate.NotAgent.selector));
        console.log("  paused", agentHandler.refusals(Mandate.AgentPaused.selector));
    }
}
