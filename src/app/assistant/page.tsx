import type { Metadata } from "next";
import { ResearchAssistant } from "@/components/ResearchAssistant";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Application chatbot — Traders Adda", description: "Local, read-only answers about radar stocks, market breadth, strategies, results and application status." };
export default function Page() { return <Suspense fallback={<p className="p-4">Loading research assistant...</p>}><ResearchAssistant /></Suspense>; }
