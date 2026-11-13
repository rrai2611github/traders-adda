import type { Metadata } from "next";
import { PerformancePage } from "@/components/PerformancePage";

export const metadata: Metadata = {
  title: "Performance & reliability — Traders Adda",
  description: "Paper results, recorded positions and system status, with simulated and actual trades kept separate.",
};

export default function Page() {
  return <PerformancePage />;
}
