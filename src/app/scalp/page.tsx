import type { Metadata } from "next";
import { ScalpDesk } from "@/components/scalp/ScalpDesk";

export const metadata: Metadata = {
  title: "Index Scalp Desk — Traders Adda",
  description: "1-minute Nifty and Bank Nifty ATM call, spot and put charts with VWAP, EMA and opening-range setups.",
};

interface ScalpPageProps {
  searchParams: Promise<{ fyers?: string; message?: string }>;
}

export default async function Page({ searchParams }: ScalpPageProps) {
  const { fyers, message } = await searchParams;
  const notice = fyers === "connected" || fyers === "error" || fyers === "not-configured"
    ? { kind: fyers as "connected" | "error" | "not-configured", message: message?.slice(0, 200) }
    : null;
  return <ScalpDesk notice={notice} />;
}
