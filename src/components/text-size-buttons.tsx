"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  NORMAL_SIZE,
  TEXT_SIZES,
  TEXT_SIZE_KEY,
  largestSize,
  sizeFrom,
  stepSize,
} from "@/domain/text-size";

const listeners = new Set<() => void>();

/** What the organizer chose. Read from this browser's storage the first time it is needed. */
let chosen: number | null = null;

function preferred(): number {
  if (chosen === null) {
    try {
      chosen = sizeFrom(localStorage.getItem(TEXT_SIZE_KEY));
    } catch {
      chosen = NORMAL_SIZE; // storage can be blocked
    }
  }
  return chosen;
}

/** The size on the page and the biggest this screen has room for, as one string, "size:largest". */
function snapshot(): string {
  const step = Number.parseFloat(getComputedStyle(document.body).getPropertyValue("--step"));
  // --step exists only where the wide layout does. Elsewhere nothing is scaled, so nothing needs holding back.
  const largest = Number.isFinite(step) ? largestSize(window.innerWidth, step) : TEXT_SIZES[TEXT_SIZES.length - 1];
  // A size chosen on a bigger screen is held back to what this one has room for, but what was chosen is kept.
  return `${Math.min(preferred(), largest)}:${largest}`;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("resize", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("resize", listener);
  };
}

function choose(size: number) {
  chosen = size;
  try {
    localStorage.setItem(TEXT_SIZE_KEY, String(size));
  } catch {
    // It still applies until the page is closed.
  }
  listeners.forEach((listener) => listener());
}

/**
 * Smaller and Larger for the wide public view, so the organizer can set the text for the room. The choice is kept in
 * this browser, which is the screen and the room it was made for, and put on the page before it is painted (see
 * `savedSizeScript`). Shows nothing until the page has loaded, and the stylesheet shows it only on a wide screen.
 */
export function TextSizeButtons() {
  const shown = useSyncExternalStore(subscribe, snapshot, () => "");
  const [size, largest] = shown.split(":").map(Number);

  // The stylesheet multiplies the screen's own scale by --size.
  useEffect(() => {
    if (shown !== "") document.documentElement.style.setProperty("--size", String(size));
  }, [shown, size]);

  if (shown === "") return null;

  return (
    <div className="textsize" role="group" aria-label="Text size">
      <button type="button" className="quiet" disabled={size <= TEXT_SIZES[0]} onClick={() => choose(stepSize(size, "smaller", largest))}>
        Smaller
      </button>
      <span className="note" aria-live="polite">
        {Math.round(size * 100)}%
      </span>
      <button type="button" className="quiet" disabled={size >= largest} onClick={() => choose(stepSize(size, "larger", largest))}>
        Larger
      </button>
      {size !== NORMAL_SIZE && (
        <button type="button" className="quiet" onClick={() => choose(NORMAL_SIZE)}>
          Reset
        </button>
      )}
    </div>
  );
}
