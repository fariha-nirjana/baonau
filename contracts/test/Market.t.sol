// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockAsset} from "../src/mocks/MockAsset.sol";
import {MockExchange} from "../src/mocks/MockExchange.sol";
import {PriceOracle} from "../src/mocks/PriceOracle.sol";
import {VaultFixture} from "./utils/VaultFixture.sol";

/// The simulated market the vault trades against: the price oracle with its
/// sanity bounds, and the mock exchange.
contract MarketTest is VaultFixture {
    // ---------------- oracle ----------------

    function test_UpdaterMovesPriceWithinTheBound() public {
        skip(ORACLE_INTERVAL);
        vm.expectEmit(true, true, true, true);
        emit PriceOracle.PriceUpdated(address(idx), 110 * PRICE, 100 * PRICE);
        vm.prank(updater);
        oracle.setPrice(address(idx), 110 * PRICE);

        (uint256 price, uint256 updatedAt) = oracle.getPrice(address(idx));
        assertEq(price, 110 * PRICE);
        assertEq(updatedAt, block.timestamp);
    }

    function test_RevertWhen_UpdateMovesPriceTooFar() public {
        skip(ORACLE_INTERVAL);
        vm.startPrank(updater);
        vm.expectRevert(
            abi.encodeWithSelector(
                PriceOracle.DeviationTooLarge.selector, address(idx), 50 * PRICE, 90 * PRICE, 110 * PRICE
            )
        );
        oracle.setPrice(address(idx), 50 * PRICE);
        vm.expectRevert(
            abi.encodeWithSelector(
                PriceOracle.DeviationTooLarge.selector, address(idx), 110 * PRICE + 1, 90 * PRICE, 110 * PRICE
            )
        );
        oracle.setPrice(address(idx), 110 * PRICE + 1);
        vm.stopPrank();
    }

    function test_RevertWhen_UpdateComesTooSoon() public {
        skip(ORACLE_INTERVAL);
        vm.startPrank(updater);
        oracle.setPrice(address(idx), 90 * PRICE);
        // a second step straight away would get around the per-update bound
        vm.expectRevert(
            abi.encodeWithSelector(
                PriceOracle.UpdateTooSoon.selector, address(idx), uint64(block.timestamp) + ORACLE_INTERVAL
            )
        );
        oracle.setPrice(address(idx), 81 * PRICE);
        vm.stopPrank();
    }

    function test_SamePriceRefreshesTheTimestamp() public {
        skip(1 hours);
        vm.prank(updater);
        oracle.setPrice(address(idx), 100 * PRICE);
        (, uint256 updatedAt) = oracle.getPrice(address(idx));
        assertEq(updatedAt, block.timestamp);
    }

    function test_BatchUpdate() public {
        skip(ORACLE_INTERVAL);
        address[] memory assets = new address[](2);
        assets[0] = address(idx);
        assets[1] = address(bond);
        uint256[] memory prices = new uint256[](2);
        prices[0] = 105 * PRICE;
        prices[1] = 101 * PRICE;
        vm.prank(updater);
        oracle.setPrices(assets, prices);
        (uint256 p,) = oracle.getPrice(address(bond));
        assertEq(p, 101 * PRICE);

        uint256[] memory short = new uint256[](1);
        vm.expectRevert(PriceOracle.LengthMismatch.selector);
        vm.prank(updater);
        oracle.setPrices(assets, short);
    }

    function test_RevertWhen_NotUpdater() public {
        skip(ORACLE_INTERVAL);
        vm.expectRevert(PriceOracle.NotUpdater.selector);
        vm.prank(attacker);
        oracle.setPrice(address(idx), 100 * PRICE);
        // the admin is not the updater either
        vm.expectRevert(PriceOracle.NotUpdater.selector);
        oracle.setPrice(address(idx), 100 * PRICE);
    }

    function test_RevertWhen_PriceIsZeroOrFeedMissing() public {
        skip(ORACLE_INTERVAL);
        vm.startPrank(updater);
        vm.expectRevert(PriceOracle.ZeroPrice.selector);
        oracle.setPrice(address(idx), 0);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.NoFeed.selector, attacker));
        oracle.setPrice(attacker, 1);
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.NoFeed.selector, attacker));
        oracle.getPrice(attacker);
    }

    function test_AdminCannotResetAFeed() public {
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.FeedExists.selector, address(idx)));
        oracle.addFeed(address(idx), 1 * PRICE, 1000);
    }

    function test_RevertWhen_FeedSetupIsInvalid() public {
        vm.expectRevert(PriceOracle.NotAdmin.selector);
        vm.prank(attacker);
        oracle.addFeed(attacker, 1 * PRICE, 1000);
        vm.expectRevert(PriceOracle.NotAdmin.selector);
        vm.prank(attacker);
        oracle.setUpdater(attacker);

        vm.expectRevert(PriceOracle.ZeroPrice.selector);
        oracle.addFeed(attacker, 0, 1000);
        vm.expectRevert(PriceOracle.InvalidBound.selector);
        oracle.addFeed(attacker, 1 * PRICE, 0);
        vm.expectRevert(PriceOracle.InvalidBound.selector);
        oracle.addFeed(attacker, 1 * PRICE, 10_000);
    }

    /// However the updater plays it, the price cannot leave the band that the
    /// bound and the minimum interval allow for the time that has passed.
    function testFuzz_PriceMoveIsBoundedOverTime(uint256 seed, uint8 steps) public {
        steps = uint8(bound(steps, 1, 20));
        uint256 lowest = 100 * PRICE;
        uint256 highest = 100 * PRICE;
        for (uint256 i = 0; i < steps; i++) {
            lowest = lowest - lowest * 1000 / 10_000;
            highest = highest + highest * 1000 / 10_000;
            skip(ORACLE_INTERVAL);
            uint256 target = bound(uint256(keccak256(abi.encode(seed, i))), 1, 1_000 * PRICE);
            vm.prank(updater);
            try oracle.setPrice(address(idx), target) {} catch {}
            (uint256 p,) = oracle.getPrice(address(idx));
            assertGe(p, lowest);
            assertLe(p, highest);
        }
    }

    // ---------------- exchange ----------------

    function test_ExchangeSwapsAtOraclePriceMinusFee() public {
        usd.mint(stranger, 1_000 * USD);
        vm.startPrank(stranger);
        usd.approve(address(exchange), 1_000 * USD);
        uint256 out = exchange.buy(address(gold), 1_000 * USD, 0);
        // 997 tUSD after the 0.3% fee, at 250 per unit
        assertEq(out, 3.988e18);
        assertEq(gold.balanceOf(stranger), 3.988e18);

        gold.approve(address(exchange), out);
        uint256 back = exchange.sell(address(gold), out, 0);
        assertEq(back, 994_009_000);
        assertEq(usd.balanceOf(stranger), 994_009_000);
        assertEq(gold.totalSupply(), 0);
        vm.stopPrank();
    }

    function test_RevertWhen_ExchangeOutputBelowMinimum() public {
        usd.mint(stranger, 1_000 * USD);
        vm.startPrank(stranger);
        usd.approve(address(exchange), 1_000 * USD);
        vm.expectRevert(abi.encodeWithSelector(MockExchange.InsufficientOutput.selector, 3.988e18, 4e18));
        exchange.buy(address(gold), 1_000 * USD, 4e18);
        vm.stopPrank();
    }

    function test_RevertWhen_AnyoneElseMintsAnAsset() public {
        vm.expectRevert(MockAsset.NotMinter.selector);
        vm.prank(attacker);
        idx.mint(attacker, 1e18);
        vm.expectRevert(MockAsset.NotMinter.selector);
        vm.prank(attacker);
        idx.burn(1);
    }
}
