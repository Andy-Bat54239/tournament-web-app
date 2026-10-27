/**
 * The text size the organizer picks for the room on the wide public view (the projector layout).
 *
 * The page already scales itself to the screen in steps. A size is a number that scale is multiplied by, so 1 is what
 * the page chose for the screen and 1.3 is 30% bigger. It is kept in the browser that chose it, because it belongs to
 * that screen and that room, and applied before the page is painted so a reload does not jump.
 */

/** What can be chosen, smallest first. Each is about a seventh to a sixth bigger than the one before. */
export const TEXT_SIZES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2] as const;

const LISTED: readonly number[] = TEXT_SIZES;

export const NORMAL_SIZE = 1;

export const TEXT_SIZE_KEY = "castle-connect-text-size";

/**
 * Below this many CSS pixels of room the wide layout gets too narrow for its columns, so a size that would leave less
 * than this on a screen is not offered. The room is the screen's width divided by everything it is scaled by.
 */
export const LEAST_ROOM = 1000;

/** The listed size closest to what was saved or read, or normal when it is not a number. */
export function sizeFrom(raw: string | null | undefined): number {
  const wanted = Number.parseFloat(raw ?? "");
  if (!Number.isFinite(wanted)) return NORMAL_SIZE;
  return TEXT_SIZES.reduce((best, size) => (Math.abs(size - wanted) < Math.abs(best - wanted) ? size : best));
}

/**
 * The biggest size this screen has room for.
 * @param screenWidth CSS pixels across the screen, at the browser's own zoom
 * @param step        the scale the page picked for the screen's width (`--step` in the stylesheet)
 */
export function largestSize(screenWidth: number, step: number): number {
  const scale = Number.isFinite(step) && step > 0 ? step : 1;
  const fits = TEXT_SIZES.filter((size) => screenWidth / (scale * size) >= LEAST_ROOM);
  return fits.length > 0 ? fits[fits.length - 1] : TEXT_SIZES[0];
}

/** The size after pressing Smaller or Larger, kept within what the screen has room for. */
export function stepSize(current: number, direction: "smaller" | "larger", largest: number): number {
  const at = LISTED.indexOf(sizeFrom(String(current)));
  const top = LISTED.indexOf(sizeFrom(String(largest)));
  const next = Math.min(Math.max(at + (direction === "larger" ? 1 : -1), 0), top);
  return TEXT_SIZES[next];
}

/**
 * A script for the head of the page that puts the saved size on the page before it is painted. It does nothing if
 * nothing was saved, and never throws (storage can be blocked).
 */
export function savedSizeScript(): string {
  const [least, most] = [TEXT_SIZES[0], TEXT_SIZES[TEXT_SIZES.length - 1]];
  return (
    `try{var n=parseFloat(localStorage.getItem(${JSON.stringify(TEXT_SIZE_KEY)}));` +
    `if(n>=${least}&&n<=${most})document.documentElement.style.setProperty("--size",String(n))}catch(e){}`
  );
}
