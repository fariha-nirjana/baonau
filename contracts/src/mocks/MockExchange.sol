// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IExchange} from "../interfaces/IExchange.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {PriceMath} from "../PriceMath.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

interface IBurnable {
    function burn(uint256 amount) external;
}

/// @title MockExchange
/// @notice A stand-in market for the testnet demo. It swaps at the oracle price
/// minus a flat fee, with unlimited liquidity: it mints the asset on a buy and
/// mints test dollars on a sell. Same inputs always give the same output, which
/// keeps market replays reproducible. It is not a model of a real venue.
contract MockExchange is IExchange {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    IERC20 public immutable stable;
    IPriceOracle public immutable oracle;
    uint256 public immutable feeBps;
    uint256 private immutable _stableUnit;

    event Swapped(
        address indexed trader, address indexed asset, bool isBuy, uint256 stableAmount, uint256 assetAmount, uint256 price
    );

    error ZeroAmount();
    error NotAnAsset();
    error InvalidFee();
    error InsufficientOutput(uint256 out, uint256 minOut);

    constructor(IERC20 stable_, IPriceOracle oracle_, uint256 feeBps_) {
        if (feeBps_ >= BPS) revert InvalidFee();
        stable = stable_;
        oracle = oracle_;
        feeBps = feeBps_;
        _stableUnit = 10 ** IERC20Metadata(address(stable_)).decimals();
    }

    function quoteBuy(address asset, uint256 stableIn) public view returns (uint256 out, uint256 price) {
        (price,) = oracle.getPrice(asset);
        uint256 net = stableIn - stableIn * feeBps / BPS;
        out = PriceMath.toAsset(net, price, _unit(asset), _stableUnit);
    }

    function quoteSell(address asset, uint256 amountIn) public view returns (uint256 out, uint256 price) {
        (price,) = oracle.getPrice(asset);
        uint256 gross = PriceMath.toStable(amountIn, price, _unit(asset), _stableUnit);
        out = gross - gross * feeBps / BPS;
    }

    function buy(address asset, uint256 stableIn, uint256 minOut) external returns (uint256 out) {
        if (stableIn == 0) revert ZeroAmount();
        if (asset == address(stable)) revert NotAnAsset();
        uint256 price;
        (out, price) = quoteBuy(asset, stableIn);
        if (out < minOut) revert InsufficientOutput(out, minOut);
        stable.safeTransferFrom(msg.sender, address(this), stableIn);
        IMintable(asset).mint(msg.sender, out);
        emit Swapped(msg.sender, asset, true, stableIn, out, price);
    }

    function sell(address asset, uint256 amountIn, uint256 minOut) external returns (uint256 out) {
        if (amountIn == 0) revert ZeroAmount();
        if (asset == address(stable)) revert NotAnAsset();
        uint256 price;
        (out, price) = quoteSell(asset, amountIn);
        if (out < minOut) revert InsufficientOutput(out, minOut);
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amountIn);
        IBurnable(asset).burn(amountIn);
        IMintable(address(stable)).mint(msg.sender, out);
        emit Swapped(msg.sender, asset, false, out, amountIn, price);
    }

    function _unit(address asset) private view returns (uint256) {
        return 10 ** IERC20Metadata(asset).decimals();
    }
}
