import type { Metadata } from "next";
import { PositionsPage } from "@/components/PositionsPage";

export const metadata: Metadata = {
  title: "Positions & strategy — Traders Adda",
  description: "Track your real trades and follow the strategy with paper money.",
};

export default function Page() {
  return <PositionsPage />;
}
