"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { skus } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { parseManualRate } from "@/lib/forecast/manual";
import { setManualDailySales } from "@/lib/forecast/repo";
import { eq } from "drizzle-orm";

export type ManualRateState = { error?: string; saved?: "set" | "cleared"; at?: number } | null;

export async function saveManualRateAction(skuId: number, _prev: ManualRateState, formData: FormData): Promise<ManualRateState> {
  const user = await requireAdmin();
  const clear = formData.get("clear") === "1";
  const parsed = clear ? { value: null } : parseManualRate(String(formData.get("manualDailySales") ?? ""));
  if ("error" in parsed) return { error: parsed.error };
  const note = clear ? null : String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  const db = getDb();
  const [sku] = await db.select({ id: skus.id }).from(skus).where(eq(skus.id, skuId));
  if (!sku) return { error: "That SKU no longer exists." };
  await setManualDailySales(db, skuId, parsed.value, parsed.value === null ? null : note, user.id);
  revalidatePath("/overview");
  revalidatePath(`/overview/${skuId}`);
  return { saved: parsed.value === null ? "cleared" : "set", at: Date.now() };
}
