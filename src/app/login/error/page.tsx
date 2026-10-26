import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "@/components/loading";

export const metadata: Metadata = { title: "Log in" };

const MESSAGES: Record<string, { title: string; body: string }> = {
  denied: {
    title: "You’re not logged in.",
    body: "You chose not to let the app see your Lichess username. Nothing was shared, and you can try again whenever you like.",
  },
  state: {
    title: "That login was stopped.",
    body: "It did not come from this browser, so it was not trusted. Please try again.",
  },
  expired: {
    title: "The login took too long.",
    body: "Or your browser blocked cookies. Please try again, and allow cookies for this site.",
  },
  failed: {
    title: "Lichess did not finish the login.",
    body: "This is usually temporary. Please try again in a moment.",
  },
  closed: {
    title: "That Lichess account can’t be used.",
    body: "It is closed or restricted on Lichess. Log in with a different account.",
  },
  unavailable: {
    title: "Logging in with Lichess is not switched on yet.",
    body: "Please ask an organizer.",
  },
};

async function Reason({ searchParams }: Pick<PageProps<"/login/error">, "searchParams">) {
  const { reason } = await searchParams;
  // Only the fixed messages above are ever shown, never anything taken from the address.
  const message = MESSAGES[typeof reason === "string" && reason in MESSAGES ? reason : "failed"];
  return (
    <div className="card">
      <p className="strong">{message.title}</p>
      <p className="note">{message.body}</p>
      <a className="button gold wide" href="/api/auth/lichess">
        Try again
      </a>
    </div>
  );
}

export default function LoginErrorPage(props: PageProps<"/login/error">) {
  return (
    <>
      <h2>Log in</h2>
      <Suspense fallback={<Loading />}>
        <Reason searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
