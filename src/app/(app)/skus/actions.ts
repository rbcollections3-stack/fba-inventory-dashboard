"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { checkSkuSheet, recheckRows, type RowIssue, type SkuImportRow } from "@/lib/skus/parse";
import { readSpreadsheet, UnreadableFileError } from "@/lib/skus/read-file";
import { importSkus, planImport, recordCount, saveSku, skuFormSchema } from "@/lib/skus/repo";

export type SkuFormState = { error?: string; fieldErrors?: Record<string, string> };

export async function saveSkuAction(
  id: number | null,
  _prev: SkuFormState,
  formData: FormData,
): Promise<SkuFormState> {
  const user = await requireAdmin();
  const countText = String(formData.get("countUnits") ?? "").trim().replace(/,/g, "");
  let countUnits: number | null = null;
  if (countText !== "") {
    countUnits = Number(countText);
    if (!/^\d+$/.test(countText) || !Number.isSafeInteger(countUnits)) {
      return {
        error: "Please fix the highlighted fields.",
        fieldErrors: { countUnits: "Enter a whole number of units, 0 or more, or leave it blank." },
      };
    }
  }
  const raw = Object.fromEntries(
    [
      "listing",
      "amazonSku",
      "inhouseSku",
      "unitsPerCase",
      "tie",
      "high",
      "maxCasesPerPallet",
      "description",
      "warehouseLocation",
      "asin",
      "notes",
    ].map((k) => [k, String(formData.get(k) ?? "")]),
  );
  const parsed = skuFormSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      fieldErrors[key] ??= issue.message;
    }
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }
  const result = await saveSku(getDb(), id, parsed.data);
  if (!result.ok) return { error: result.error };
  if (countUnits !== null) {
    await recordCount(getDb(), result.id, countUnits, {
      userId: user.id,
      countedOn: new Date().toISOString().slice(0, 10),
    });
    revalidatePath("/warehouse");
  }
  revalidatePath("/skus");
  redirect("/skus");
}

export type ImportState =
  | { stage: "start" }
  | { stage: "problems"; fileName: string; errors: RowIssue[]; warnings: RowIssue[] }
  | {
      stage: "preview";
      fileName: string;
      rows: SkuImportRow[];
      warnings: RowIssue[];
      newCount: number;
      updateCount: number;
      existing: string[];
    }
  | { stage: "done"; created: number; updated: number };

/** Step 1: read the uploaded file and check every row. Nothing is saved. */
export async function checkImportAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return {
      stage: "problems",
      fileName: "",
      errors: [{ row: null, message: "Choose the filled-in SKU template to upload." }],
      warnings: [],
    };
  }
  let check;
  try {
    const table = await readSpreadsheet(file.name, await file.arrayBuffer());
    check = checkSkuSheet(table);
  } catch (err) {
    if (err instanceof UnreadableFileError) {
      return { stage: "problems", fileName: file.name, errors: [{ row: null, message: err.message }], warnings: [] };
    }
    throw err;
  }
  if (check.errors.length > 0) {
    return { stage: "problems", fileName: file.name, errors: check.errors, warnings: check.warnings };
  }
  const plan = await planImport(getDb(), check.rows);
  if (plan.errors.length > 0) {
    return { stage: "problems", fileName: file.name, errors: plan.errors, warnings: check.warnings };
  }
  return {
    stage: "preview",
    fileName: file.name,
    rows: check.rows,
    warnings: check.warnings,
    newCount: plan.newCount,
    updateCount: plan.updateCount,
    existing: [...plan.existing],
  };
}

/** Step 2: save the checked rows. They are checked again before saving. */
export async function confirmImportAction(rowsJson: string): Promise<ImportState> {
  const user = await requireAdmin();
  let input: unknown;
  try {
    input = JSON.parse(rowsJson);
  } catch {
    input = null;
  }
  const check = recheckRows(input);
  if (check.errors.length > 0) {
    return { stage: "problems", fileName: "", errors: check.errors, warnings: check.warnings };
  }
  const today = new Date().toISOString().slice(0, 10);
  const result = await importSkus(getDb(), check.rows, { userId: user.id, today });
  if (!result.ok) return { stage: "problems", fileName: "", errors: result.errors, warnings: [] };
  revalidatePath("/skus");
  revalidatePath("/warehouse");
  return { stage: "done", created: result.created, updated: result.updated };
}
