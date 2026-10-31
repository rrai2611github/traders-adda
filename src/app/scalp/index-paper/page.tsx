import type { Metadata } from "next";
import { IndexPaperDesk } from "@/components/scalp/IndexPaperDesk";

export const metadata: Metadata = {
  title: "Index Paper Desk — Traders Adda",
  description: "Paper trade Nifty and Bank Nifty futures long or short on live Fyers prices, with the daily-trend and hourly-entry framework checklist. No real orders.",
};

export default function Page() {
  return <IndexPaperDesk />;
}
