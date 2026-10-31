import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IndexAnalysisPage } from "@/components/IndexAnalysisPage";
import { DEFAULT_INDEX_SYMBOLS } from "@/lib/market/defaults";

const INDEX_NAMES: Record<string, string> = {
  NIFTY50: "Nifty 50",
  BANKNIFTY: "Nifty Bank",
  NIFTYMIDCAP: "Nifty Midcap 100",
  NIFTYIT: "Nifty IT",
  INDIAVIX: "India VIX",
};

const validSymbol = (value: string) => {
  const symbol = value.toUpperCase();
  return DEFAULT_INDEX_SYMBOLS.includes(symbol) ? symbol : null;
};

export function generateStaticParams() {
  return DEFAULT_INDEX_SYMBOLS.map((symbol) => ({ symbol: symbol.toLowerCase() }));
}

interface IndexPageProps {
  params: Promise<{ symbol: string }>;
}

export async function generateMetadata({ params }: IndexPageProps): Promise<Metadata> {
  const { symbol: rawSymbol } = await params;
  const symbol = validSymbol(rawSymbol);
  return {
    title: symbol ? `${INDEX_NAMES[symbol]} Analysis — Traders Adda` : "Index Analysis — Traders Adda",
    description: symbol ? `Live quote, chart and technical analysis for ${INDEX_NAMES[symbol]}.` : undefined,
  };
}

export default async function Page({ params }: IndexPageProps) {
  const { symbol: rawSymbol } = await params;
  const symbol = validSymbol(rawSymbol);
  if (!symbol) notFound();
  return <IndexAnalysisPage symbol={symbol} />;
}
