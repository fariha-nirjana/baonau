// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPriceOracle {
    /// @return price USD per whole token, 8 decimals
    /// @return updatedAt timestamp of the last update
    function getPrice(address asset) external view returns (uint256 price, uint256 updatedAt);
}
