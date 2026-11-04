import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { jobFolder, publicFile, uploadEnabled } from "@/lib/jobs";

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".json": "application/json",
};

function downloadName(folder: string, relative: string) {
  // 公開用のPDFの名前に、元のファイル名（会社名が入ることがある）を使わない
  if (relative.startsWith("masked/")) return encodeURIComponent("朱書き_公開用.pdf");
  const job = JSON.parse(readFileSync(path.join(folder, "job.json"), "utf8"));
  const base = path.basename(String(job.original_name)).replace(/\.pdf$/i, "");
  return encodeURIComponent(`朱書き_${base}.pdf`);
}

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/check/[id]/files/[...path]">,
) {
  const { id, path: parts } = await ctx.params;
  const folder = uploadEnabled() ? jobFolder(id) : null;
  const relative = parts.join("/");
  const file = folder && publicFile(folder, relative);
  if (!folder || !file || !existsSync(file)) {
    return new Response("見つかりません", { status: 404 });
  }
  const extension = path.extname(file);
  const headers: Record<string, string> = {
    "Content-Type": TYPES[extension],
    "Cache-Control": "no-store",
  };
  if (extension === ".pdf") {
    headers["Content-Disposition"] = `attachment; filename*=UTF-8''${downloadName(folder, relative)}`;
  }
  return new Response(readFileSync(file), { headers });
}
