import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { historyStamp } from "./historyRefresh.ts";
import type { BacktestResult, BacktestSettings } from "./types.ts";

export type JobState =
  | { status: "running"; id: string; message: string; startedAt: number }
  | { status: "failed"; id: string; error: string }
  | { status: "done"; id: string; result: BacktestResult };

const RESULT_DIR = join(process.cwd(), ".cache", "backtest-results");
const jobs = new Map<string, JobState>();

/** Bump when the result shape changes, so saved results from an older shape are run again. */
const RESULT_VERSION = 5;
export const settingsId = (settings: BacktestSettings) => createHash("sha1").update(`v${RESULT_VERSION}:${historyStamp()}:${JSON.stringify(settings)}`).digest("hex").slice(0, 16);
const resultPath = (id: string) => join(RESULT_DIR, `${id}.json`);

/** Starts a backtest in a separate process (it takes a minute on first use and must not block the website), or returns the saved result. */
export function startBacktest(settings: BacktestSettings): JobState {
  const id = settingsId(settings);
  const existing = jobs.get(id);
  if (existing?.status === "running") return existing;
  if (existsSync(resultPath(id))) {
    try {
      const done: JobState = { status: "done", id, result: JSON.parse(readFileSync(resultPath(id), "utf8")) };
      jobs.set(id, done);
      return done;
    } catch { /* unreadable: run again */ }
  }
  mkdirSync(RESULT_DIR, { recursive: true });
  const settingsFile = join(RESULT_DIR, `${id}.settings.json`);
  writeFileSync(settingsFile, JSON.stringify(settings));
  const state: JobState = { status: "running", id, message: "starting", startedAt: Date.now() };
  jobs.set(id, state);
  const child = spawn(process.execPath, ["--no-warnings", join(process.cwd(), "scripts", "backtest-job.mjs"), settingsFile, resultPath(id)], { cwd: process.cwd(), windowsHide: true });
  let tail = "";
  child.stdout.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
    if (lines.length) state.message = lines[lines.length - 1];
  });
  child.stderr.on("data", (chunk: Buffer) => { tail = (tail + chunk.toString()).slice(-600); });
  child.on("close", (code) => {
    if (code === 0 && existsSync(resultPath(id))) {
      try { jobs.set(id, { status: "done", id, result: JSON.parse(readFileSync(resultPath(id), "utf8")) }); return; } catch { /* fall through */ }
    }
    jobs.set(id, { status: "failed", id, error: tail.trim() || `The backtest stopped (exit ${code}).` });
  });
  return state;
}

export const getBacktest = (id: string): JobState | null => jobs.get(id) ?? null;
