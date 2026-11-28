"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { skus } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { createShipment, readShipmentForm, type LineIssue } from "@/lib/shipments/repo";

export type PlanState = { error?: string; issues?: LineIssue[] } | null;

export async function createShipmentAction(_prev: PlanState, formData: FormData): Promise<PlanState> {
  const user = await requireAdmin();
  const db = getDb();
  const ids = (await db.select({ id: skus.id }).from(skus)).map((s) => s.id);
  const { lines, issues } = readShipmentForm(formData, ids);
  if (issues.length > 0) return { issues, error: "Nothing was saved. Fix the rows marked in red." };
  const note = String(formData.get("note") ?? "").slice(0, 500);
  const result = await createShipment(db, lines, { userId: user.id, note });
  if (!result.ok) return { error: result.error };
  revalidatePath("/shipments");
  revalidatePath("/warehouse");
  revalidatePath("/warehouse/shipments");
  redirect(`/warehouse/shipments/${result.id}?new=1`);
}
