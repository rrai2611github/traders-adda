import type { Metadata } from "next";
import { TrackerPage } from "@/components/TrackerPage";

export const metadata: Metadata = {
  title: "Live strategy check — Traders Adda",
  description: "Follow the backtested Blue sky + Multi-year breakouts rules day by day on real prices, with open positions, stops and results.",
};

export default function Page() {
  return <TrackerPage />;
}
