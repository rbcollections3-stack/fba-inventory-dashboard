"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { ReportFormatError } from "@/lib/amazon/parse";
import { readUploadedReport } from "@/lib/amazon/read-upload";
import { saveAmazonReport, type SaveResult } from "@/lib/amazon/repo";

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
