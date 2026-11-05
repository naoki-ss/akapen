import type { NextRequest } from "next/server";
import { crossSite, MAX_UPLOAD_BYTES, uploadEnabled } from "@/lib/jobs";
import { receiveSet, validIds } from "@/lib/ledger";

const error = (message: string, status: number) =>
  Response.json({ error: message }, { status });

// 新しい版のPDFを受け取り、図番・図名を読んで束ねる先の案を返す。AIは呼ばない
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/projects/[slug]/ledger">,
) {
  const { slug } = await ctx.params;
  if (!uploadEnabled() || crossSite(request) || !validIds(slug))
    return error("この環境では入れられません", 403);
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return error("PDFを選んでください", 400);
  if (file.size > MAX_UPLOAD_BYTES)
    return error("ファイルが大きすぎます（100MBまで）", 413);
  const pdf = Buffer.from(await file.arrayBuffer());
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-")
    return error("PDFファイルではありません", 400);
  try {
    return Response.json(await receiveSet(slug, pdf));
  } catch (failure) {
    return error((failure as Error).message, 400);
  }
}
