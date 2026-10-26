import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "@/components/loading";
import { OrganizerContent } from "@/components/organizer-content";

export const metadata: Metadata = { title: "Organizer" };

export default function OrganizerPage() {
  return (
    <>
      <h2>Organizer</h2>
      <Suspense fallback={<Loading />}>
        <OrganizerContent />
      </Suspense>
    </>
  );
}
