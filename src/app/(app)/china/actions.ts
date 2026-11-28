"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { skus } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import {
  cancelChinaOrder,
  closeChinaOrder,
  createChinaOrder,
  getChinaOrder,
  updateChinaOrderDetails,
} from "@/lib/china/repo";
import { readOrderDetails, readOrderLines, type DetailsIssue, type LineIssue } from "@/lib/china/rules";
import { businessToday } from "@/lib/dates";

export type OrderState = { error?: string; issues?: LineIssue[]; detailIssues?: DetailsIssue[] } | null;

function refresh(id?: number) {
  for (const p of ["/china", "/overview", "/warehouse", "/warehouse/receiving", "/shipments"]) revalidatePath(p);
  if (id) {
    revalidatePath(`/china/${id}`);
    revalidatePath(`/warehouse/receiving/${id}`);
  }
}

/** Admin: record an order placed with a China supplier. */
export async function createChinaOrderAction(_prev: OrderState, formData: FormData): Promise<OrderState> {
  const user = await requireAdmin();
  const db = getDb();
  const ids = (await db.select({ id: skus.id }).from(skus)).map((s) => s.id);
  const { lines, issues } = readOrderLines(formData, ids);
  const { details, issues: detailIssues } = readOrderDetails(formData, businessToday());
  if (issues.length > 0 || !details) {
    return { issues, detailIssues, error: "Nothing was saved. Fix the parts marked in red." };
  }
  const result = await createChinaOrder(db, lines, details, { userId: user.id });
  if (!result.ok) return { error: result.error };
  refresh(result.id);
  redirect(`/china/${result.id}?new=1`);
}

export type DetailsState = { error?: string; detailIssues?: DetailsIssue[]; saved?: boolean } | null;

/** Admin: change the expected arrival date, PO number, supplier or note. */
export async function updateDetailsAction(id: number, _prev: DetailsState, formData: FormData): Promise<DetailsState> {
  await requireAdmin();
  const db = getDb();
  const o = await getChinaOrder(db, id);
  if (!o) return { error: "This order no longer exists." };
  const { details, issues } = readOrderDetails(formData, businessToday());
  if (!details) return { detailIssues: issues, error: "Nothing was saved. Fix the dates marked in red." };
  await updateChinaOrderDetails(db, id, details);
  refresh(id);
  return { saved: true };
}

export async function closeChinaOrderAction(id: number): Promise<void> {
  const user = await requireAdmin();
  await closeChinaOrder(getDb(), id, user.id);
  refresh(id);
  redirect(`/china/${id}?closed=1`);
}

export async function cancelChinaOrderAction(id: number): Promise<void> {
  const user = await requireAdmin();
  const r = await cancelChinaOrder(getDb(), id, user.id);
  refresh(id);
  redirect(`/china/${id}${r.ok ? "?cancelled=1" : "?cancelError=1"}`);
}
