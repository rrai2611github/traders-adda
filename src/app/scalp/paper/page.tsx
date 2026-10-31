import type { Metadata } from "next";
import { PaperStraddle } from "@/components/scalp/PaperStraddle";

export const metadata: Metadata = {
  title: "Paper straddle — Traders Adda",
  description: "The 09:20 short straddle tracked daily with real Fyers option prices. No real orders.",
};

export default function Page() {
  return <PaperStraddle />;
}
