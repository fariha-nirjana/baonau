// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IExchange {
    /// @notice Spend `stableIn` of the stable asset on `asset`. Reverts if less than `minOut` comes back.
    function buy(address asset, uint256 stableIn, uint256 minOut) external returns (uint256 out);

    /// @notice Sell `amountIn` of `asset` for the stable asset. Reverts if less than `minOut` comes back.
    function sell(address asset, uint256 amountIn, uint256 minOut) external returns (uint256 out);
}
