import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { SpApiClient, spApiConfigFromEnv } from "@/lib/amazon/sp-api";
import { syncAmazon } from "@/lib/amazon/sync";

// Amazon takes a few minutes to prepare reports, so this run may wait up to 5 minutes.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Called by Vercel Cron (see vercel.json) twice each morning. The second call
 * picks up reports Amazon had not finished in time for the first, and does
 * nothing when today's reports are already loaded.
 */
export async function GET(request: Request) {
  if (!authorised(request)) return new Response("Not allowed", { status: 401 });
  const config = spApiConfigFromEnv();
  if (!config) return Response.json({ ok: false, reason: "Amazon keys are not set up" });
  const outcomes = await syncAmazon(getDb(), new SpApiClient(config), {
    trigger: "schedule",
    deadline: Date.now() + (maxDuration - 20) * 1000,
  });
  // Only counts and statuses are returned, never report contents.
  return Response.json({
    ok: outcomes.every((o) => o.status !== "failed"),
    reports: outcomes.map((o) => ({ kind: o.kind, status: o.status })),
  });
}
