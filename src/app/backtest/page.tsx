import type { Metadata } from "next";
import { BacktestPage } from "@/components/BacktestPage";

export const metadata: Metadata = {
  title: "Backtest — Traders Adda",
  description: "Test a stock-selection rule on ten years of NSE prices: entries, stops, exits, costs and the market-breadth gate.",
};

export default function Page() {
  return <BacktestPage />;
}
