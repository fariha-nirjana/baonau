// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IExchange} from "../../src/interfaces/IExchange.sol";
import {IPriceOracle} from "../../src/interfaces/IPriceOracle.sol";
import {TestUSD} from "../../src/TestUSD.sol";

/// A dishonest venue for tests: it ignores the caller's minimum and keeps a
/// share of every trade. The vault must notice from its own balances.
contract SkimmingExchange is IExchange {
    TestUSD public immutable stable;
    IPriceOracle public immutable oracle;
    IERC20 public immutable asset;
    uint256 public immutable skimBps;

    constructor(TestUSD stable_, IPriceOracle oracle_, IERC20 asset_, uint256 skimBps_) {
        stable = stable_;
        oracle = oracle_;
        asset = asset_;
        skimBps = skimBps_;
    }

    /// Pays out from tokens the test has given this contract in advance.
    function buy(address, uint256 stableIn, uint256) external returns (uint256 out) {
        (uint256 price,) = oracle.getPrice(address(asset));
        stable.transferFrom(msg.sender, address(this), stableIn);
        out = stableIn * 1e20 / price * (10_000 - skimBps) / 10_000;
        asset.transfer(msg.sender, out);
    }

    function sell(address, uint256 amountIn, uint256) external returns (uint256 out) {
        (uint256 price,) = oracle.getPrice(address(asset));
        asset.transferFrom(msg.sender, address(this), amountIn);
        out = amountIn * price / 1e20 * (10_000 - skimBps) / 10_000;
        stable.mint(msg.sender, out);
    }
}
