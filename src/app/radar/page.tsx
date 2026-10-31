import type { Metadata } from "next";
import { RadarPage } from "@/components/RadarPage";

export const metadata: Metadata = {
  title: "Email track record — Traders Adda",
  description: "Every stock the emails gave out, followed against the finished daily prices to see how the picks actually did.",
};

export default function Page() {
  return <RadarPage />;
}
