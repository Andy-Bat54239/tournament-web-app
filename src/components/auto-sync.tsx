"use client";

import { useEffect } from "react";
import { syncMyMatch } from "@/app/actions";

/**
 * Keeps the match screen current: every few seconds it asks the server to read the game from Lichess and
 * refresh the page. It pauses while the tab is hidden. Rendering a page never changes anything, so the reading
 * happens here, through an action.
 */
export function AutoSync({ everyMs }: { everyMs: number }) {
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden) {
        try {
          await syncMyMatch();
        } catch {
          // A failed poll is not worth interrupting the player for. The next one tries again.
        }
      }
      if (!stopped) timer = setTimeout(tick, everyMs);
    };
    timer = setTimeout(tick, everyMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [everyMs]);

  return null;
}
