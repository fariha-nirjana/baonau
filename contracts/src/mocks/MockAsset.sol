// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockAsset
/// @notice A simulated test asset for the testnet demo (index fund, bond fund, gold).
/// It has no value and is not backed by anything. Only the mock exchange can mint or burn it.
contract MockAsset is ERC20 {
    address public immutable minter;

    error NotMinter();

    constructor(string memory name_, string memory symbol_, address minter_) ERC20(name_, symbol_) {
        minter = minter_;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        _mint(to, amount);
    }

    /// @notice Burns the minter's own tokens.
    function burn(uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        _burn(msg.sender, amount);
    }
}
