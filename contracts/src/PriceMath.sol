// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Conversions between an asset amount and its value in the stable asset.
/// Prices are USD per whole token with 8 decimals. One stable unit is treated as one dollar.
library PriceMath {
    uint256 internal constant PRICE_UNIT = 1e8;

    function toStable(uint256 amount, uint256 price, uint256 assetUnit, uint256 stableUnit)
        internal
        pure
        returns (uint256)
    {
        return Math.mulDiv(amount, price * stableUnit, assetUnit * PRICE_UNIT);
    }

    function toAsset(uint256 stableAmount, uint256 price, uint256 assetUnit, uint256 stableUnit)
        internal
        pure
        returns (uint256)
    {
        return Math.mulDiv(stableAmount, assetUnit * PRICE_UNIT, price * stableUnit);
    }
}
