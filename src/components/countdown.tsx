"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatCountdown } from "@/domain/play";

/**
 * Counts down to `closesAt`. It starts from the seconds the server worked out, so the first paint matches the
 * server's, then follows the clock. When it reaches zero it refreshes the page once, so "Claim win" turns on.
 */
export function Countdown({ closesAt, initialSeconds }: { closesAt: string; initialSeconds: number }) {
  const router = useRouter();
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.ceil((Date.parse(closesAt) - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [closesAt]);

  useEffect(() => {
    if (seconds === 0 && initialSeconds > 0) router.refresh();
  }, [seconds, initialSeconds, router]);

  return (
    <span role="timer" className={seconds === 0 ? "timer over" : "timer"}>
      {seconds === 0 ? "0:00" : formatCountdown(seconds)}
    </span>
  );
}
