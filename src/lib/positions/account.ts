import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The account size the user has chosen to save on this computer (the browser keeps its own copy for the calculators). Saving it is also the
 * opt-in for the private "tomorrow's plan" email, which needs it to size the orders.
 */
const DIR = join(process.cwd(), ".cache");
const FILE = join(DIR, "account.json");

export const MIN_ACCOUNT = 10_000;
export const MAX_ACCOUNT = 1_000_000_000;

export function readAccount(): number | null {
  try {
    const value = Number((JSON.parse(readFileSync(FILE, "utf8")) as { accountSize?: number }).accountSize);
    return Number.isFinite(value) && value >= MIN_ACCOUNT && value <= MAX_ACCOUNT ? value : null;
  } catch {
    return null;
  }
}

/** Saves the account size; false (and nothing saved) when it is not a sensible amount. */
export function writeAccount(value: unknown): boolean {
  const n = Number(value);
  if (!Number.isFinite(n) || n < MIN_ACCOUNT || n > MAX_ACCOUNT) return false;
  mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ accountSize: Math.round(n) }));
  renameSync(tmp, FILE);
  return true;
}

/** Turns the plan email off again by forgetting the saved account size. */
export function clearAccount(): void {
  rmSync(FILE, { force: true });
}
