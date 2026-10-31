import type { Metadata } from "next";
import { ScalpBacktest } from "@/components/scalp/ScalpBacktest";

export const metadata: Metadata = {
  title: "Index strategy backtest — Traders Adda",
  description: "Nifty and Bank Nifty scalps, intraday holds and 1–3 day swings replayed on historical data, after costs.",
};

export default function Page() {
  return <ScalpBacktest />;
}
