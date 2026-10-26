import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "@/components/loading";
import { MatchContent } from "@/components/match-content";

export const metadata: Metadata = { title: "My match" };

export default function MatchPage() {
  return (
    <>
      <h2>My match</h2>
      <Suspense fallback={<Loading label="Loading your match…" />}>
        <MatchContent />
      </Suspense>
    </>
  );
}
