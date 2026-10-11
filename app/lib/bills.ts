import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import seed from "../config/bills.seed.json";

/**
 * Bills are what the owner expects to pay: who, how much and by when.
 * The agent reads them to know what is due, and the policy engine uses them to
 * decide whether a payment asked for by a document matches something expected.
 */
export type Bill = {
  id: string;
  mandateId: number;
  label: string;
  amount: string;
  dueDate: string;
  /** requested: sent to the owner for approval and not yet paid. */
  status: "due" | "requested" | "paid";
  tx?: string;
};

const PATH = join(process.cwd(), "data", "bills.json");

export function readBills(): Bill[] {
  if (!existsSync(PATH)) return seed as Bill[];
  return JSON.parse(readFileSync(PATH, "utf8")) as Bill[];
}

export function updateBill(id: string, patch: Partial<Pick<Bill, "status" | "tx">>) {
  const bills = readBills().map((b) => (b.id === id ? { ...b, ...patch } : b));
  mkdirSync(dirname(PATH), { recursive: true });
  writeFileSync(PATH, JSON.stringify(bills, null, 2) + "\n");
}
