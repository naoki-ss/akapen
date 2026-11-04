import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { exportMarked, jobFolder, uploadEnabled } from "@/lib/jobs";

// 朱書きPDFのダウンロード。外した指摘を除いて返す
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/check/[id]/export">,
) {
  const { id } = await ctx.params;
  const folder = uploadEnabled() ? jobFolder(id) : null;
  if (!folder) return new Response("見つかりません", { status: 404 });
  const isPublic = request.nextUrl.searchParams.get("public") === "1";
  let file: string;
  try {
    file = await exportMarked(folder, isPublic);
  } catch {
    return new Response("朱書きPDFを作れませんでした", { status: 500 });
  }
  if (!existsSync(file)) return new Response("見つかりません", { status: 404 });
  // 公開用のPDFの名前に、元のファイル名（会社名が入ることがある）を使わない
  const job = JSON.parse(readFileSync(path.join(folder, "job.json"), "utf8"));
  const base = path.basename(String(job.original_name)).replace(/\.pdf$/i, "");
  const name = encodeURIComponent(
    isPublic ? "朱書き_公開用.pdf" : `朱書き_${base}.pdf`,
  );
  return new Response(readFileSync(file), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename*=UTF-8''${name}`,
    },
  });
}
