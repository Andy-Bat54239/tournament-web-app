import { NextResponse, type NextRequest } from "next/server";
import { syncResults } from "@/server/instance";
import { hasSecret } from "@/server/sync";

/**
 * Reads results from Lichess for games nobody has open. Something outside the app calls this every minute or
 * so (see the README): a cron service, or Vercel Cron, which sends the CRON_SECRET as a bearer token.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/sync
 *
 * Without CRON_SECRET set it refuses everyone, so the address can never be used by a stranger.
 */
async function run(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const headers = { "Cache-Control": "no-store" };
  if (!secret) {
    return NextResponse.json({ error: "Background reading is off: CRON_SECRET is not set." }, { status: 503, headers });
  }
  if (!hasSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401, headers });
  }
  try {
    return NextResponse.json(await syncResults(), { headers });
  } catch (error) {
    console.error("Reading results failed:", error);
    return NextResponse.json({ error: "Reading results failed." }, { status: 500, headers });
  }
}

export const GET = run;
export const POST = run;
