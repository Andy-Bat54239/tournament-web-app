import type { Metadata } from "next";
import { Suspense } from "react";
import { BracketContent } from "@/components/bracket-content";
import { Loading } from "@/components/loading";

export const metadata: Metadata = { title: "Bracket" };

export default function BracketPage() {
  // The `.live` wrapper is outside the Suspense so the page is the right width from the first paint on a wide screen.
  return (
    <div className="live">
      <Suspense fallback={<Loading label="Loading the bracket…" />}>
        <BracketContent />
      </Suspense>
    </div>
  );
}
