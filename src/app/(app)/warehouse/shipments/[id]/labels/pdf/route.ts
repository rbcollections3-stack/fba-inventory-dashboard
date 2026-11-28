import { getDb } from "@/db";
import { SpApiClient, SpApiError, spApiConfigFromEnv } from "@/lib/amazon/sp-api";
import { getCurrentUser } from "@/lib/auth/session";
import { downloadLabels, isBoxId, readShipmentIds } from "@/lib/labels/amazon";
import { getShipment } from "@/lib/shipments/repo";

export const dynamic = "force-dynamic";

function fail(message: string, status = 400) {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/**
 * Downloads Amazon's 4x6 box or pallet labels for one Amazon shipment of an
 * app shipment, for the logged-in admin or warehouse staff. Read only.
 */
export async function GET(request: Request, ctx: RouteContext<"/warehouse/shipments/[id]/labels/pdf">) {
  const user = await getCurrentUser();
  if (!user) return fail("Please log in again.", 401);
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return fail("Unknown shipment.", 404);
  const s = await getShipment(getDb(), id);
  if (!s || s.status === "cancelled") return fail("This shipment does not exist or was cancelled.", 404);

  const url = new URL(request.url);
  const fbaId = String(url.searchParams.get("ship") ?? "").toUpperCase();
  if (!readShipmentIds(s.amazonShipmentId ?? "").ids.includes(fbaId)) return fail("That Amazon shipment is not part of this shipment.");
  const config = spApiConfigFromEnv();
  if (!config) return fail("The app is not connected to Amazon.", 503);

  const kind = url.searchParams.get("kind");
  try {
    let file;
    let name;
    if (kind === "box") {
      const boxIds = String(url.searchParams.get("boxes") ?? "")
        .split(",")
        .map((b) => b.trim().toUpperCase())
        .filter((b) => isBoxId(b) && b.startsWith(fbaId));
      if (boxIds.length === 0) return fail("No box labels were asked for.");
      file = await downloadLabels(new SpApiClient(config), fbaId, { kind: "box", boxIds });
      name = `${fbaId}-box-labels-${boxIds[0].slice(-3)}-${boxIds[boxIds.length - 1].slice(-3)}.pdf`;
    } else if (kind === "pallet") {
      const pallets = Number(url.searchParams.get("pallets"));
      file = await downloadLabels(new SpApiClient(config), fbaId, { kind: "pallet", pallets });
      name = `${fbaId}-pallet-labels.pdf`;
    } else {
      return fail("Unknown label type.");
    }
    return new Response(file.bytes, {
      headers: {
        "content-type": file.contentType.includes("pdf") ? "application/pdf" : file.contentType,
        "content-disposition": `inline; filename="${name}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    return fail(err instanceof SpApiError ? err.message : err instanceof Error ? err.message : "Amazon could not be reached.", 502);
  }
}
