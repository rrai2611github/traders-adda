import type { Metadata } from "next";
import { PositionsPage } from "@/components/PositionsPage";

export const metadata: Metadata = {
  title: "My positions — Traders Adda",
  description: "Your real trades watched against the tested exit rules, with a journal of what you did.",
};

export default function Page() {
  return <PositionsPage />;
}
