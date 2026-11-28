"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import { businessToday } from "@/lib/dates";
import { cancelShipment, getShipment, markShipmentSent, setAmazonShipmentId } from "@/lib/shipments/repo";
import { readCountForm, type CountIssue } from "@/lib/warehouse/counts";

export type SendState = { error?: string; issues?: CountIssue[] } | null;

function refresh(id: number) {
  for (const p of ["/warehouse", "/warehouse/shipments", `/warehouse/shipments/${id}`, "/warehouse/counts", "/shipments", "/overview", "/skus"]) {
    revalidatePath(p);
  }
}

/** Warehouse staff or the admin: the shipment has left; save what is left on the shelf. */
export async function markSentAction(id: number, _prev: SendState, formData: FormData): Promise<SendState> {
  const user = await requireUser();
  const db = getDb();
  const s = await getShipment(db, id);
  if (!s) return { error: "This shipment no longer exists." };
  const { entries, issues } = readCountForm(formData, s.lines.map((l) => l.skuId));
  if (issues.length > 0) return { issues, error: "Nothing was saved. Fix the rows marked in red." };
  const result = await markShipmentSent(db, id, entries, { userId: user.id, today: businessToday() });
  if (!result.ok) return { error: result.error, issues: result.issues };
  refresh(id);
  redirect(`/warehouse/shipments/${id}?sent=1`);
}

export async function cancelShipmentAction(id: number): Promise<void> {
  const user = await requireAdmin();
  await cancelShipment(getDb(), id, user.id);
  refresh(id);
  redirect(`/warehouse/shipments/${id}`);
}

export async function saveAmazonIdAction(id: number, formData: FormData): Promise<void> {
  await requireAdmin();
  const value = String(formData.get("amazonShipmentId") ?? "").trim().slice(0, 40);
  await setAmazonShipmentId(getDb(), id, value || null);
  refresh(id);
}
