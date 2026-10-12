// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IExchange} from "./interfaces/IExchange.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {Mandate} from "./Mandate.sol";
import {PolicyVault} from "./PolicyVault.sol";

/// @title VaultFactory
/// @notice Creates a mandate and its vault together, as lightweight copies of
/// two templates, and binds each to the other for good.
///
/// It also closes one way around the waiting period. A first mandate is signed
/// without a wait, so an owner could otherwise leave a vault, open a new one
/// and sign looser terms on the spot. Here only an owner's first vault starts
/// at once. Every later vault of the same owner can only have its first
/// mandate signed after the waiting period of that owner's previous mandate.
///
/// What this does not stop: an owner can always take their funds and leave,
/// or come back under another address. The friction is on raising risk inside
/// the product. It is never custody of the owner's funds.
contract VaultFactory {
    address public immutable mandateTemplate;
    address public immutable vaultTemplate;
    IERC20 public immutable stable;
    IPriceOracle public immutable oracle;
    IExchange public immutable exchange;
    uint64 public immutable maxPriceAge;

    /// @notice The mandate each owner created most recently.
    mapping(address => Mandate) public latestMandate;
    mapping(address => bool) public isVault;
    uint256 public vaultCount;

    event VaultCreated(address indexed owner, address indexed mandate, address indexed vault, uint64 activeFrom);

    constructor(IERC20 stable_, IPriceOracle oracle_, IExchange exchange_, uint64 maxPriceAge_) {
        stable = stable_;
        oracle = oracle_;
        exchange = exchange_;
        maxPriceAge = maxPriceAge_;
        mandateTemplate = address(new Mandate());
        vaultTemplate = address(new PolicyVault());
    }

    /// @notice Create a vault and its mandate for the caller.
    /// @param guardian may be zero
    /// @param loosenDelay how long a change that raises risk will wait
    function createVault(address guardian, uint64 loosenDelay) external returns (Mandate mandate, PolicyVault vault) {
        Mandate previous = latestMandate[msg.sender];
        uint64 activeFrom = uint64(block.timestamp);
        if (address(previous) != address(0)) activeFrom += previous.loosenDelay();

        mandate = Mandate(Clones.clone(mandateTemplate));
        vault = PolicyVault(Clones.clone(vaultTemplate));
        mandate.init(msg.sender, guardian, address(vault), address(stable), oracle, loosenDelay, activeFrom);
        vault.init(mandate, stable, oracle, exchange, maxPriceAge);

        latestMandate[msg.sender] = mandate;
        isVault[address(vault)] = true;
        vaultCount++;
        emit VaultCreated(msg.sender, address(mandate), address(vault), activeFrom);
    }
}
