import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "@/components/loading";
import { SignUpContent } from "@/components/sign-up-content";

export const metadata: Metadata = { title: "Sign up" };

export default function SignUpPage() {
  return (
    <>
      <h2>Sign up</h2>
      <Suspense fallback={<Loading />}>
        <SignUpContent />
      </Suspense>
    </>
  );
}
