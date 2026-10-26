import type { Metadata } from "next";
import { Suspense } from "react";
import { BracketContent } from "@/components/bracket-content";
import { Loading } from "@/components/loading";

export const metadata: Metadata = { title: "Bracket" };

export default function BracketPage() {
  return (
    <Suspense fallback={<Loading label="Loading the bracket…" />}>
      <BracketContent />
    </Suspense>
  );
}
