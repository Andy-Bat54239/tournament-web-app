"use client";

import { useSyncExternalStore } from "react";

const never = () => () => {};

/**
 * Fills the screen with the page, for a projector. The stylesheet hides the header and the tabs while the page is
 * full screen. Shows nothing where the browser cannot do it, such as an iPhone, and the stylesheet shows it only
 * on a wide screen.
 */
export function FullScreenButton() {
  const supported = useSyncExternalStore(
    never,
    () => document.fullscreenEnabled,
    () => false,
  );
  if (!supported) return null;
  return (
    <button
      type="button"
      className="quiet fullscreen"
      onClick={() => void document.documentElement.requestFullscreen().catch(() => {})}
    >
      Full screen
    </button>
  );
}
