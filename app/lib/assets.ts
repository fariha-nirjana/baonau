import type { Address } from "viem";
import { chainConfig } from "./config";

export const SYMBOLS = ["IDX", "BOND", "GOLD", "MEME"] as const;
export type AssetSymbol = (typeof SYMBOLS)[number];

export type AssetInfo = {
  symbol: AssetSymbol;
  /** The on-chain token symbol. */
  token: string;
  name: string;
  /** Shown wherever the asset is named, so nobody takes it for a real fund. */
  label: string;
  address: Address;
  decimals: number;
};

const NOTE = "simulated tokenized asset (testnet)";

/** Every token the app knows about. MEME is known so that it can be refused by name; it is not in any mandate. */
export function assets(): Record<AssetSymbol, AssetInfo> {
  const cfg = chainConfig();
  return {
    IDX: { symbol: "IDX", token: "tIDX", name: "Index fund", label: `Index fund, ${NOTE}`, address: cfg.IDX_ADDRESS, decimals: 18 },
    BOND: { symbol: "BOND", token: "tBOND", name: "Bond fund", label: `Bond fund, ${NOTE}`, address: cfg.BOND_ADDRESS, decimals: 18 },
    GOLD: { symbol: "GOLD", token: "tGOLD", name: "Gold", label: `Gold, ${NOTE}`, address: cfg.GOLD_ADDRESS, decimals: 18 },
    MEME: { symbol: "MEME", token: "MEME", name: "Moon Meme Coin", label: "Moon Meme Coin, test token", address: cfg.MEME_ADDRESS, decimals: 18 },
  };
}

export function assetBySymbol(symbol: string): AssetInfo | undefined {
  return assets()[symbol.toUpperCase().replace(/^T(?=IDX|BOND|GOLD)/, "") as AssetSymbol];
}

export function assetByAddress(address: string): AssetInfo | undefined {
  return Object.values(assets()).find((a) => a.address.toLowerCase() === address.toLowerCase());
}
