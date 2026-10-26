"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Brings a page that anyone can leave open, such as the public view on a projector, up to date every so often.
 * It reloads what the server renders, not the whole page, and pauses while the tab is hidden.
 */
export function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
