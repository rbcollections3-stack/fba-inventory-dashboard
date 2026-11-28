import { ReportFormatError } from "./parse";

/** Largest report text accepted after unzipping (a month of ledger is about 4 MB). */
export const MAX_REPORT_BYTES = 60 * 1024 * 1024;

async function gunzipLimited(data: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REPORT_BYTES) {
      await reader.cancel();
      throw new ReportFormatError("This report is too large. Download a shorter date range (one or two months).");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/**
 * The upload page zips each report in the browser before sending it (a month
 * of ledger shrinks from about 4 MB to well under 1 MB). This turns an
 * uploaded file, zipped or not, back into the report's text.
 */
export async function readUploadedReport(file: File): Promise<{ name: string; text: string }> {
  const data = await file.arrayBuffer();
  const zipped = file.name.endsWith(".gz");
  let bytes: Uint8Array;
  try {
    bytes = zipped ? await gunzipLimited(data) : new Uint8Array(data);
  } catch (err) {
    if (err instanceof ReportFormatError) throw err;
    throw new ReportFormatError("This file could not be read. Download it again from Seller Central and retry.");
  }
  if (bytes.byteLength > MAX_REPORT_BYTES) {
    throw new ReportFormatError("This report is too large. Download a shorter date range (one or two months).");
  }
  const name = zipped ? file.name.slice(0, -3) : file.name;
  if (/\.(xlsx|xls|pdf|zip)$/i.test(name)) {
    throw new ReportFormatError("Upload the report as Seller Central downloads it (.txt, .tsv or .csv), without opening and re-saving it in Excel.");
  }
  return { name, text: new TextDecoder("utf-8").decode(bytes) };
}
