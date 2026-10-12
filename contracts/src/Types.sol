// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11 <0.9.0;

/// @notice The mandate's limits. Shares are in basis points of the portfolio's value.
struct Policy {
    uint16 maxTradeBps; // largest single agent trade, as a share of the current value
    uint16 maxDailyVolumeBps; // agent volume per UTC day, buys plus sells, as a share of the day-start value
    uint16 dailyLossBps; // drop from the day-start value that starts protect mode
    uint16 maxSlippageBps; // worst execution against the oracle price a trade may accept
    uint16 minDefensiveBps; // smallest share that must stay in cash and defensive assets after a buy
    uint8 maxLossStreak; // losing sells in a row that start a cooldown; 0 for off
    uint32 cooldown; // seconds without new buying after a loss trigger
}

/// @notice The mandate's rule for one asset.
struct AssetRule {
    bool allowed; // the agent may buy it
    bool defensive; // counts toward the minimum defensive share
    uint16 maxExposureBps; // largest share of the portfolio it may be after a buy
    uint256 stopPrice; // oracle price at or below which anyone can sell the holding; 0 for none
}
