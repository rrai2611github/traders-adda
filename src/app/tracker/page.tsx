import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Positions & strategy — Traders Adda",
  description: "Your real positions and the paper-money live strategy check.",
};

export default function Page() {
  redirect("/positions#strategy-check");
}
