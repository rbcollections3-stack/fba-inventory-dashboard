"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { getChinaOrder, receiveChinaOrder } from "@/lib/china/repo";
import { readArrivedForm, type LineIssue } from "@/lib/china/rules";
import { businessToday } from "@/lib/dates";
import { readCountForm } from "@/lib/warehouse/counts";

export type ReceiveState = { error?: string; issues?: LineIssue[] } | null;

/** Warehouse staff or the admin: a delivery from China came in; save what arrived and the shelf count. */
export async function receiveAction(id: number, _prev: ReceiveState, formData: FormData): Promise<ReceiveState> {
  const user = await requireUser();
  const db = getDb();
  const o = await getChinaOrder(db, id);
  if (!o) return { error: "This order no longer exists." };
  const ids = o.lines.map((l) => l.skuId);
  const arrived = readArrivedForm(formData, ids);
  const counted = readCountForm(formData, ids);
  const issues = [...arrived.issues, ...counted.issues];
  if (issues.length > 0) return { issues, error: "Nothing was saved. Fix the rows marked in red." };
  const result = await receiveChinaOrder(db, id, arrived.entries, counted.entries, { userId: user.id, today: businessToday() });
  if (!result.ok) return { error: result.error, issues: result.issues };
  for (const p of ["/warehouse", "/warehouse/receiving", `/warehouse/receiving/${id}`, "/warehouse/counts", "/china", `/china/${id}`, "/overview", "/skus", "/shipments"]) {
    revalidatePath(p);
  }
  redirect(`/warehouse/receiving/${id}?saved=${result.complete ? "all" : "part"}`);
}
