/**
 * Ugandan WhatsApp numbers, checked for format only (brief, section 7A).
 * Accepts spaces, dashes, dots and brackets, and returns +256XXXXXXXXX.
 */
export function normalizeUgandaPhone(input: string): string | null {
  const compact = input.replace(/[\s\-().]/g, "");
  return /^\+256\d{9}$/.test(compact) ? compact : null;
}

/** +256772123456 becomes "+256 772 123 456". */
export function formatUgandaPhone(e164: string): string {
  return e164.replace(/^(\+256)(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4");
}
