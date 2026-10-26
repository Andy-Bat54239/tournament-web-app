/** A Lichess Swiss id is eight letters and digits, as in https://lichess.org/swiss/AbCdEfGh. */
const SWISS_ID = /^[A-Za-z0-9]{8}$/;

/**
 * The Swiss id from whatever an organizer pastes: the page address, the address with more after it, or the
 * bare id. Null if it is none of those, for instance an address on another website.
 */
export function parseSwissId(input: string): string | null {
  const text = input.trim();
  if (SWISS_ID.test(text)) return text;

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.hostname !== "lichess.org" && url.hostname !== "www.lichess.org") return null;
  const [kind, id] = url.pathname.split("/").filter(Boolean);
  return kind === "swiss" && id && SWISS_ID.test(id) ? id : null;
}
