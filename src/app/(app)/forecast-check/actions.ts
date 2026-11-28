"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getDb } from "@/db";
import { listings, seasonMonths, seasonSettings } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { missingSpApiSettings, SpApiClient, spApiConfigFromEnv } from "@/lib/amazon/sp-api";
import { requestLedgerHistory, syncAmazon } from "@/lib/amazon/sync";
import { parseSeasonPct } from "@/lib/forecast/seasonal";

export type SeasonState = { error?: string; saved?: boolean; at?: number } | null;

export async function saveSeasonAction(listingId: number, _prev: SeasonState, formData: FormData): Promise<SeasonState> {
  const user = await requireAdmin();
  const db = getDb();
  const [listing] = await db.select({ id: listings.id }).from(listings).where(eq(listings.id, listingId));
  if (!listing) return { error: "That listing no longer exists." };

  const clearAll = formData.get("clear") === "1";
  const enabled = clearAll ? true : formData.get("enabled") === "on";
  const typed: { month: number; percent: number }[] = [];
  if (!clearAll) {
    for (let m = 1; m <= 12; m++) {
      const parsed = parseSeasonPct(String(formData.get(`m${m}`) ?? ""));
      if ("error" in parsed) return { error: `${new Date(Date.UTC(2026, m - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })}: ${parsed.error}` };
      if (parsed.value !== null) typed.push({ month: m, percent: parsed.value });
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(seasonSettings)
      .values({ listingId, enabled, updatedBy: user.id })
      .onConflictDoUpdate({ target: seasonSettings.listingId, set: { enabled, updatedBy: user.id, updatedAt: new Date() } });
    await tx.delete(seasonMonths).where(eq(seasonMonths.listingId, listingId));
    if (typed.length > 0) {
      await tx.insert(seasonMonths).values(typed.map((t) => ({ listingId, ...t, updatedBy: user.id })));
    }
  });
  revalidatePath("/forecast-check");
  revalidatePath("/overview");
  revalidatePath("/shipments");
  return { saved: true, at: Date.now() };
}

export type HistoryState = { message: string; ok: boolean } | null;

const WAIT_ON_PAGE_MS = 45_000;

export async function loadHistoryAction(_prev: HistoryState): Promise<HistoryState> {
  const user = await requireAdmin();
  const config = spApiConfigFromEnv();
  if (!config) {
    return { ok: false, message: `The Amazon keys are not set up yet (missing: ${missingSpApiSettings().join(", ")}).` };
  }
  const db = getDb();
  const client = new SpApiClient(config);
  const started = Date.now();
  const asked = await requestLedgerHistory(db, client, { userId: user.id });
  if (asked.status === "failed") return { ok: false, message: asked.message };
  if (asked.status === "busy") {
    return {
      ok: false,
      message: "Amazon is still preparing another Inventory Ledger report. Try again in about 10 minutes.",
    };
  }
  const outcomes = await syncAmazon(db, client, {
    trigger: "manual",
    userId: user.id,
    request: false,
    deadline: started + WAIT_ON_PAGE_MS,
    pollMs: 10_000,
  });
  const ledger = outcomes.find((o) => o.kind === "ledger_detail");
  if (ledger?.status === "waiting" || !ledger) {
    // A long report takes Amazon a while. Keep checking after the page answers,
    // and the morning pull picks it up if it is still not ready.
    after(async () => {
      await syncAmazon(getDb(), client, { trigger: "manual", userId: user.id, request: false, deadline: started + 280_000, pollMs: 15_000 });
    });
    revalidatePath("/forecast-check");
    return {
      ok: true,
      message:
        "Asked Amazon for the last 18 months. A report this long can take Amazon 5 to 30 minutes. It loads by itself; reload this page later to see it.",
    };
  }
  revalidatePath("/forecast-check");
  revalidatePath("/overview");
  if (ledger.status === "saved") {
    return {
      ok: true,
      message: `Loaded sales history from ${ledger.result.periodStart ?? "?"} to ${ledger.result.periodEnd ?? "?"} (found ${ledger.result.skusMatched} of your SKUs).`,
    };
  }
  if (ledger.status === "no_data") return { ok: false, message: "Amazon had no ledger data for the last 18 months." };
  return { ok: false, message: ledger.status === "failed" ? ledger.message : "Something went wrong. Try again later." };
}
