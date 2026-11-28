import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { amazonSyncRequests } from "@/db/schema";
import { businessTimeZone, businessToday } from "@/lib/dates";
import { parseAmazonReport, ReportFormatError, type LedgerReport } from "./parse";
import { saveInventoryReport, saveLedgerReport, type SaveResult } from "./repo";
import { REPORT_TYPES, SpApiError, type ReportsClient, type SyncKind } from "./sp-api";

/**
 * The daily Amazon pull. Each run:
 *  1. asks Amazon for the Manage FBA Inventory report and the last 31 days of
 *     the Inventory Ledger (detailed view), unless today's are already loaded
 *     (the Refresh button always asks again),
 *  2. checks every few seconds until Amazon has them ready, then loads them
 *     with the same code as a hand upload.
 * Amazon usually needs 1 to 5 minutes. A report that is not ready when the run
 * has to stop stays "requested" and the next run (or Refresh) picks it up.
 */

export const SYNC_KINDS: SyncKind[] = ["fba_inventory", "ledger_detail"];

/** Days of ledger asked for on each pull. Overlapping days replace older numbers. */
export const LEDGER_DAYS = 31;

export const KIND_NAME: Record<SyncKind, string> = {
  fba_inventory: "Manage FBA Inventory",
  ledger_detail: "Inventory Ledger",
};

export type SyncOptions = {
  trigger: "schedule" | "manual";
  userId?: number | null;
  /** Stop checking Amazon at this time (ms since epoch). */
  deadline: number;
  /** Ask Amazon for new reports. Default: manual always, schedule once a day. */
  request?: boolean;
  pollMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

export type KindOutcome =
  | { kind: SyncKind; status: "saved"; result: SaveResult }
  | { kind: SyncKind; status: "waiting" | "no_data" | "skipped" }
  | { kind: SyncKind; status: "failed"; message: string };

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/** A request row with no Amazon id yet means the app stopped while sending it. */
const UNSENT_AFTER_MS = 10 * 60 * 1000;
/** Time kept back at the end of a run to download and save a finished report. */
const SAVE_MARGIN_MS = 30_000;

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Minutes the time zone is ahead of UTC at this moment (Pacific is -480 or -420). */
function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** The moment a business day (YYYY-MM-DD) starts, in the business time zone. */
export function startOfBusinessDay(iso: string, timeZone = businessTimeZone()): Date {
  const guess = new Date(iso + "T00:00:00Z");
  let t = guess.getTime() - zoneOffsetMinutes(guess, timeZone) * 60000;
  t = guess.getTime() - zoneOffsetMinutes(new Date(t), timeZone) * 60000;
  return new Date(t);
}

/** Whole days from LEDGER_DAYS days ago up to the end of yesterday. */
export function ledgerRange(now: Date): { startDay: string; endDay: string; start: Date; end: Date } {
  const today = businessToday(now);
  const startDay = addDays(today, -LEDGER_DAYS);
  const endDay = addDays(today, -1);
  return {
    startDay,
    endDay,
    start: startOfBusinessDay(startDay),
    end: new Date(startOfBusinessDay(today).getTime() - 1000),
  };
}

/**
 * Days of past sales asked for when the owner loads the sales history
 * (Phase 7). Amazon keeps the Inventory Ledger for 18 months; 540 days stays
 * just inside that.
 */
export const HISTORY_DAYS = 540;

/** Whole days from HISTORY_DAYS days ago up to the end of yesterday. */
export function historyRange(now: Date): { startDay: string; endDay: string; start: Date; end: Date } {
  const today = businessToday(now);
  const startDay = addDays(today, -HISTORY_DAYS);
  const endDay = addDays(today, -1);
  return {
    startDay,
    endDay,
    start: startOfBusinessDay(startDay),
    end: new Date(startOfBusinessDay(today).getTime() - 1000),
  };
}

export type HistoryRequestOutcome =
  | { status: "requested" }
  | { status: "busy" }
  | { status: "failed"; message: string };

/**
 * Asks Amazon for up to 18 months of the Inventory Ledger in one report. It is
 * then checked and saved like the daily one (by the next run, the Refresh
 * button, or the caller polling with syncAmazon({ request: false })).
 * "busy" means another Inventory Ledger report is still being prepared.
 */
export async function requestLedgerHistory(
  db: Db,
  client: ReportsClient,
  opts: { userId?: number | null; now?: Date } = {},
): Promise<HistoryRequestOutcome> {
  const now = opts.now ?? new Date();
  await expireStale(db, now);
  const range = historyRange(now);
  const [row] = await db
    .insert(amazonSyncRequests)
    .values({
      kind: "ledger_detail",
      reportType: REPORT_TYPES.ledger_detail,
      trigger: "history",
      requestedBy: opts.userId ?? null,
      requestedAt: now,
      dataStart: range.start,
      dataEnd: range.end,
    })
    .onConflictDoNothing()
    .returning({ id: amazonSyncRequests.id });
  if (!row) return { status: "busy" };
  try {
    const reportId = await client.createReport(REPORT_TYPES.ledger_detail, { start: range.start, end: range.end });
    await db.update(amazonSyncRequests).set({ amazonReportId: reportId }).where(eq(amazonSyncRequests.id, row.id));
    return { status: "requested" };
  } catch (err) {
    const message = errorText(err);
    await finish(db, row.id, "failed", { message });
    return { status: "failed", message };
  }
}

/** The newest history request, for the forecast check page. */
export async function latestHistoryRequest(db: Db) {
  const [row] = await db
    .select()
    .from(amazonSyncRequests)
    .where(eq(amazonSyncRequests.trigger, "history"))
    .orderBy(desc(amazonSyncRequests.requestedAt), desc(amazonSyncRequests.id))
    .limit(1);
  return row ?? null;
}

/**
 * Keeps only whole days inside the range asked for, so a part day at either
 * end never replaces a full day saved earlier. The saved period starts on the
 * first day asked for (so days with no sales are cleared too) and ends on the
 * last day Amazon had data for (Amazon can be a day behind).
 */
export function trimLedger(report: LedgerReport, startDay: string, endDay: string): LedgerReport {
  const rows = report.rows.filter((r) => r.day >= startDay && r.day <= endDay);
  const lastDay = rows.reduce<string | null>((m, r) => (m === null || r.day > m ? r.day : m), null);
  return {
    ...report,
    rows,
    periodStart: lastDay ? startDay : null,
    periodEnd: lastDay,
  };
}

function errorText(err: unknown): string {
  if (err instanceof SpApiError || err instanceof ReportFormatError) return err.message;
  // Network failures and the like. Never include request details (they could hold keys).
  return "Could not reach Amazon. The next check will try again.";
}

async function finish(db: Db, id: number, status: "saved" | "no_data" | "failed", extra: { message?: string; importId?: number } = {}) {
  await db
    .update(amazonSyncRequests)
    .set({ status, finishedAt: new Date(), message: extra.message ?? null, importId: extra.importId ?? null })
    .where(eq(amazonSyncRequests.id, id));
}

/** Gives up on requests Amazon never finished, so a new one can be made. */
async function expireStale(db: Db, now: Date) {
  await db
    .update(amazonSyncRequests)
    .set({ status: "failed", finishedAt: now, message: "Amazon did not finish this report in time. A new one will be requested." })
    .where(
      and(
        eq(amazonSyncRequests.status, "requested"),
        or(
          lt(amazonSyncRequests.requestedAt, new Date(now.getTime() - STALE_AFTER_MS)),
          and(isNull(amazonSyncRequests.amazonReportId), lt(amazonSyncRequests.requestedAt, new Date(now.getTime() - UNSENT_AFTER_MS))),
        ),
      ),
    );
}

/** True when a report of this kind was already loaded today (business time zone). */
async function loadedToday(db: Db, kind: SyncKind, now: Date): Promise<boolean> {
  const since = startOfBusinessDay(businessToday(now));
  const [row] = await db
    .select({ id: amazonSyncRequests.id })
    .from(amazonSyncRequests)
    .where(
      and(
        eq(amazonSyncRequests.kind, kind),
        sql`${amazonSyncRequests.status} in ('saved', 'no_data')`,
        sql`${amazonSyncRequests.requestedAt} >= ${since.toISOString()}`,
      ),
    )
    .limit(1);
  return !!row;
}

async function requestReport(db: Db, client: ReportsClient, kind: SyncKind, opts: SyncOptions, now: Date): Promise<KindOutcome | null> {
  const range = kind === "ledger_detail" ? ledgerRange(now) : null;
  const [row] = await db
    .insert(amazonSyncRequests)
    .values({
      kind,
      reportType: REPORT_TYPES[kind],
      trigger: opts.trigger,
      requestedBy: opts.userId ?? null,
      requestedAt: now,
      dataStart: range?.start ?? null,
      dataEnd: range?.end ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: amazonSyncRequests.id });
  if (!row) return null; // another run is already waiting on this report
  try {
    const reportId = await client.createReport(REPORT_TYPES[kind], range ? { start: range.start, end: range.end } : undefined);
    await db.update(amazonSyncRequests).set({ amazonReportId: reportId }).where(eq(amazonSyncRequests.id, row.id));
    return null;
  } catch (err) {
    const message = errorText(err);
    await finish(db, row.id, "failed", { message });
    return { kind, status: "failed", message };
  }
}

type Waiting = typeof amazonSyncRequests.$inferSelect;

async function checkOnce(db: Db, client: ReportsClient, req: Waiting, opts: SyncOptions): Promise<KindOutcome> {
  const kind = req.kind as SyncKind;
  try {
    const status = await client.getReport(req.amazonReportId!);
    await db.update(amazonSyncRequests).set({ checkedAt: new Date() }).where(eq(amazonSyncRequests.id, req.id));
    if (status.processingStatus === "IN_QUEUE" || status.processingStatus === "IN_PROGRESS") {
      return { kind, status: "waiting" };
    }
    if (status.processingStatus === "CANCELLED") {
      await finish(db, req.id, "no_data", { message: "Amazon had no data for this report." });
      return { kind, status: "no_data" };
    }
    if (status.processingStatus === "FATAL" || !status.reportDocumentId) {
      const message = "Amazon could not make this report. The next check will ask again.";
      await finish(db, req.id, "failed", { message });
      return { kind, status: "failed", message };
    }

    const text = await client.downloadReport(status.reportDocumentId);
    const report = parseAmazonReport(text);
    if (report.kind !== kind) {
      throw new ReportFormatError(`Amazon sent a ${KIND_NAME[report.kind]} report when ${KIND_NAME[kind]} was asked for.`);
    }
    const meta = {
      source: "sp_api" as const,
      fileName: `${KIND_NAME[kind]} (Amazon report ${req.amazonReportId})`,
      userId: req.requestedBy ?? opts.userId ?? null,
    };
    let result: SaveResult;
    if (report.kind === "ledger_detail") {
      const tz = businessTimeZone();
      const startDay = req.dataStart ? req.dataStart.toLocaleDateString("en-CA", { timeZone: tz }) : (report.periodStart ?? "");
      const endDay = req.dataEnd ? req.dataEnd.toLocaleDateString("en-CA", { timeZone: tz }) : (report.periodEnd ?? "");
      result = await saveLedgerReport(db, trimLedger(report, startDay, endDay), meta);
    } else {
      const asOf = new Date(status.processingEndTime ?? status.createdTime ?? Date.now());
      result = await saveInventoryReport(db, report, { ...meta, asOf });
    }
    await finish(db, req.id, "saved", { importId: result.importId });
    return { kind, status: "saved", result };
  } catch (err) {
    const message = errorText(err);
    // A temporary problem (Amazon busy, network) leaves the request waiting for the next check.
    const temporary = err instanceof SpApiError ? err.status === 429 || (err.status ?? 0) >= 500 : !(err instanceof ReportFormatError);
    if (temporary) return { kind, status: "waiting" };
    await finish(db, req.id, "failed", { message });
    return { kind, status: "failed", message };
  }
}

export async function syncAmazon(db: Db, client: ReportsClient, opts: SyncOptions): Promise<KindOutcome[]> {
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 15_000;
  const outcomes = new Map<SyncKind, KindOutcome>();

  await expireStale(db, now());

  for (const kind of SYNC_KINDS) {
    const ask = opts.request ?? (opts.trigger === "manual" || !(await loadedToday(db, kind, now())));
    if (!ask) {
      outcomes.set(kind, { kind, status: "skipped" });
      continue;
    }
    const failed = await requestReport(db, client, kind, opts, now());
    if (failed) outcomes.set(kind, failed);
  }

  for (;;) {
    const waiting = await db
      .select()
      .from(amazonSyncRequests)
      .where(and(eq(amazonSyncRequests.status, "requested"), sql`${amazonSyncRequests.amazonReportId} is not null`))
      .orderBy(desc(amazonSyncRequests.id));
    if (waiting.length === 0) break;
    let stillWaiting = false;
    for (const req of waiting) {
      const o = await checkOnce(db, client, req, opts);
      outcomes.set(o.kind, o);
      if (o.status === "waiting") stillWaiting = true;
    }
    if (!stillWaiting || now().getTime() + pollMs + SAVE_MARGIN_MS > opts.deadline) break;
    await sleep(pollMs);
  }

  return SYNC_KINDS.filter((k) => outcomes.has(k)).map((k) => outcomes.get(k)!);
}

export type KindStatus = {
  kind: SyncKind;
  /** The newest request of this kind, whatever happened to it. */
  latest: Waiting | null;
  /** The newest request that loaded data. */
  lastSaved: Waiting | null;
};

/** What the Amazon page shows about the automatic pull. */
export async function amazonSyncStatus(db: Db): Promise<KindStatus[]> {
  return Promise.all(
    SYNC_KINDS.map(async (kind) => {
      const [latest] = await db
        .select()
        .from(amazonSyncRequests)
        .where(eq(amazonSyncRequests.kind, kind))
        .orderBy(desc(amazonSyncRequests.requestedAt), desc(amazonSyncRequests.id))
        .limit(1);
      const [lastSaved] = await db
        .select()
        .from(amazonSyncRequests)
        .where(and(eq(amazonSyncRequests.kind, kind), eq(amazonSyncRequests.status, "saved")))
        .orderBy(desc(amazonSyncRequests.finishedAt), desc(amazonSyncRequests.id))
        .limit(1);
      return { kind, latest: latest ?? null, lastSaved: lastSaved ?? null };
    }),
  );
}
