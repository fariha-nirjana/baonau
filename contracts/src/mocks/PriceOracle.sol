// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @title PriceOracle
/// @notice Price feed for the simulated assets. One updater key pushes prices,
/// so the feed is a trusted party and a known risk. Two on-chain bounds limit
/// what a stolen or faulty updater can do:
///   - one update cannot move a price by more than the feed's maxDeviationBps
///   - updates to one feed are at least minInterval seconds apart
/// Nobody can bypass the bounds, including the admin: a feed can be added once
/// and never reset.
contract PriceOracle is IPriceOracle {
    struct Feed {
        uint256 price;
        uint64 updatedAt;
        uint16 maxDeviationBps;
    }

    uint8 public constant decimals = 8;

    address public immutable admin;
    uint64 public immutable minInterval;
    address public updater;

    mapping(address => Feed) private _feeds;

    event FeedAdded(address indexed asset, uint256 price, uint16 maxDeviationBps);
    event PriceUpdated(address indexed asset, uint256 price, uint256 previous);
    event UpdaterChanged(address indexed updater);

    error NotAdmin();
    error NotUpdater();
    error NoFeed(address asset);
    error FeedExists(address asset);
    error ZeroPrice();
    error InvalidBound();
    error LengthMismatch();
    error UpdateTooSoon(address asset, uint64 nextAllowed);
    error DeviationTooLarge(address asset, uint256 price, uint256 lowest, uint256 highest);

    constructor(address updater_, uint64 minInterval_) {
        admin = msg.sender;
        updater = updater_;
        minInterval = minInterval_;
        emit UpdaterChanged(updater_);
    }

    function addFeed(address asset, uint256 price, uint16 maxDeviationBps) external {
        if (msg.sender != admin) revert NotAdmin();
        if (_feeds[asset].price != 0) revert FeedExists(asset);
        if (price == 0) revert ZeroPrice();
        if (maxDeviationBps == 0 || maxDeviationBps >= 10_000) revert InvalidBound();
        _feeds[asset] = Feed(price, uint64(block.timestamp), maxDeviationBps);
        emit FeedAdded(asset, price, maxDeviationBps);
    }

    function setUpdater(address newUpdater) external {
        if (msg.sender != admin) revert NotAdmin();
        updater = newUpdater;
        emit UpdaterChanged(newUpdater);
    }

    /// @notice Push a new price. Pushing the same price again refreshes its timestamp.
    function setPrice(address asset, uint256 price) external {
        if (msg.sender != updater) revert NotUpdater();
        _set(asset, price);
    }

    function setPrices(address[] calldata assets, uint256[] calldata prices) external {
        if (msg.sender != updater) revert NotUpdater();
        if (assets.length != prices.length) revert LengthMismatch();
        for (uint256 i = 0; i < assets.length; i++) {
            _set(assets[i], prices[i]);
        }
    }

    function getPrice(address asset) external view returns (uint256 price, uint256 updatedAt) {
        Feed storage f = _feeds[asset];
        if (f.price == 0) revert NoFeed(asset);
        return (f.price, f.updatedAt);
    }

    function getFeed(address asset) external view returns (Feed memory) {
        return _feeds[asset];
    }

    /// @notice The range the next update of this feed must fall in.
    function allowedRange(address asset) public view returns (uint256 lowest, uint256 highest) {
        Feed storage f = _feeds[asset];
        uint256 delta = f.price * f.maxDeviationBps / 10_000;
        return (f.price - delta, f.price + delta);
    }

    function _set(address asset, uint256 price) internal {
        Feed storage f = _feeds[asset];
        uint256 previous = f.price;
        if (previous == 0) revert NoFeed(asset);
        if (price == 0) revert ZeroPrice();
        uint64 nextAllowed = f.updatedAt + minInterval;
        if (block.timestamp < nextAllowed) revert UpdateTooSoon(asset, nextAllowed);
        (uint256 lowest, uint256 highest) = allowedRange(asset);
        if (price < lowest || price > highest) revert DeviationTooLarge(asset, price, lowest, highest);
        f.price = price;
        f.updatedAt = uint64(block.timestamp);
        emit PriceUpdated(asset, price, previous);
    }
}
