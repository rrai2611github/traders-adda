import type { Metadata } from "next";
import { PlaybookPage } from "@/components/PlaybookPage";
import { LIVE_RULES } from "@/lib/backtest/tracker";

export const metadata: Metadata = {
  title: "Trading playbook — Traders Adda",
  description: "A step-by-step routine for using this app to find, size, practise, record and exit trades, with what is proven and what is not.",
};

/** A server page so the strategy text comes from the same `LIVE_RULES` the live strategy check runs on, and cannot drift from it. */
export default function Page() {
  return <PlaybookPage rules={{ name: LIVE_RULES.name, lines: [...LIVE_RULES.lines] }} />;
}
