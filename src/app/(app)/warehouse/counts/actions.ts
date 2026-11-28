"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { skus } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { businessToday } from "@/lib/dates";
import { readCountForm, saveCounts, type CountIssue } from "@/lib/warehouse/counts";

export type CountState = { saved?: number; issues?: CountIssue[]; error?: string; at?: number } | null;

export async function saveCountsAction(_prev: CountState, formData: FormData): Promise<CountState> {
  // Warehouse staff and the admin can both enter counts.
  const user = await requireUser();
  const db = getDb();
  const ids = (await db.select({ id: skus.id }).from(skus)).map((s) => s.id);
  const { entries, issues } = readCountForm(formData, ids);
  if (issues.length > 0) return { issues, error: "Nothing was saved. Fix the rows marked in red." };
  if (entries.length === 0) return { error: "Type a count for at least one SKU, then press Save counts." };
  const result = await saveCounts(db, entries, { userId: user.id, countedOn: businessToday() });
  if (result.issues.length > 0) return { issues: result.issues, error: "Nothing was saved. Fix the rows marked in red." };
  revalidatePath("/warehouse/counts");
  revalidatePath("/warehouse");
  revalidatePath("/skus");
  return { saved: result.saved, at: Date.now() };
}
