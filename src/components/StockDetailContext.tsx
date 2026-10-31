"use client";

import { createContext, useContext, type ReactNode } from "react";

const StockDetailContext = createContext<((symbol: string) => void) | null>(null);

export const StockDetailProvider = StockDetailContext.Provider;

export function useOpenStock(): ((symbol: string) => void) | null {
  return useContext(StockDetailContext);
}

/** Symbol label that opens the shared stock detail drawer when a provider is present. */
export function StockSymbolButton({
  symbol,
  className = "",
  children,
}: {
  symbol: string;
  className?: string;
  children?: ReactNode;
}) {
  const openStock = useOpenStock();
  if (!openStock) return <span className={className}>{children ?? symbol}</span>;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        openStock(symbol);
      }}
      title={`Open ${symbol} details`}
      className={`cursor-pointer text-left underline-offset-4 transition-colors hover:text-emerald-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 ${className}`}
    >
      {children ?? symbol}
    </button>
  );
}
