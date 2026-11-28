"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { ReportFormatError } from "@/lib/amazon/parse";
import { readUploadedReport } from "@/lib/amazon/read-upload";
import { saveAmazonReport, type SaveResult } from "@/lib/amazon/repo";
import { missingSpApiSettings, SpApiClient, spApiConfigFromEnv, type SyncKind } from "@/lib/amazon/sp-api";
import { syncAmazon, type KindOutcome } from "@/lib/amazon/sync";

export type FileOutcome =
  | { fileName: string; ok: true; result: Omit<SaveResult, "asOf"> & { asOf: string | null } }
  | { fileName: string; ok: false; error: string };

export type UploadState = { outcomes: FileOutcome[] } | null;

const MAX_FILES = 6;

export async function uploadAmazonReportsAction(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const user = await requireAdmin();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return { outcomes: [{ fileName: "", ok: false, error: "Choose one or more Amazon report files to upload." }] };
  }
  if (files.length > MAX_FILES) {
    return { outcomes: [{ fileName: "", ok: false, error: `Upload at most ${MAX_FILES} files at a time.` }] };
  }
  const outcomes: FileOutcome[] = [];
  for (const file of files) {
    let name = file.name.replace(/\.gz$/, "");
    try {
      const read = await readUploadedReport(file);
      name = read.name;
      const result = await saveAmazonReport(getDb(), read.text, { source: "upload", fileName: name, userId: user.id });
      outcomes.push({ fileName: name, ok: true, result: { ...result, asOf: result.asOf?.toISOString() ?? null } });
    } catch (err) {
      if (err instanceof ReportFormatError) outcomes.push({ fileName: name, ok: false, error: err.message });
      else throw err;
    }
  }
  revalidatePath("/skus");
  revalidatePath("/amazon");
  return { outcomes };
}

export type RefreshState = {
  outcomes: { kind: SyncKind; status: KindOutcome["status"]; message?: string; skusMatched?: number }[];
  error?: string;
} | null;

/** Seconds the Refresh button waits before handing the rest to the background. */
const WAIT_ON_PAGE_MS = 45_000;

export async function refreshFromAmazonAction(_prev: RefreshState): Promise<RefreshState> {
  const user = await requireAdmin();
  const config = spApiConfigFromEnv();
  if (!config) {
    return { outcomes: [], error: `The Amazon keys are not set up yet (missing: ${missingSpApiSettings().join(", ")}).` };
  }
  const client = new SpApiClient(config);
  const started = Date.now();
  const outcomes = await syncAmazon(getDb(), client, {
    trigger: "manual",
    userId: user.id,
    deadline: started + WAIT_ON_PAGE_MS,
    pollMs: 10_000,
  });
  if (outcomes.some((o) => o.status === "waiting")) {
    // Keep checking after the page has answered, until the time limit.
    after(async () => {
      await syncAmazon(getDb(), client, {
        trigger: "manual",
        userId: user.id,
        request: false,
        deadline: started + 280_000,
        pollMs: 15_000,
      });
    });
  }
  revalidatePath("/skus");
  revalidatePath("/amazon");
  return {
    outcomes: outcomes.map((o) => ({
      kind: o.kind,
      status: o.status,
      message: o.status === "failed" ? o.message : undefined,
      skusMatched: o.status === "saved" ? o.result.skusMatched : undefined,
    })),
  };
}
