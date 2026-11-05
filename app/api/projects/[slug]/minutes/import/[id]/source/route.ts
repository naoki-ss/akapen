import path from "node:path";
import type { NextRequest } from "next/server";
import { uploadEnabled } from "@/lib/jobs";
import { minutesSourceFile } from "@/lib/minutes";

// 元のファイルを開く。公開する環境では見せない
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/projects/[slug]/minutes/import/[id]/source">,
) {
  const { slug, id } = await ctx.params;
  const found = uploadEnabled() ? minutesSourceFile(slug, id) : null;
  if (!found) return new Response("見つかりません", { status: 404 });
  const extension = path.extname(found.viewable).toLowerCase();
  const isPdf = extension === ".pdf";
  // PDF にできなかった Word は、ブラウザで開けないのでファイルのまま渡す
  if (extension === ".docx") {
    return new Response(new Uint8Array(found.data), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8\'\'${encodeURIComponent(found.name)}`,
      },
    });
  }
  let body: BodyInit = new Uint8Array(found.data);
  if (!isPdf) {
    // テキストは文字コードが UTF-8 とは限らない
    try {
      body = new TextDecoder("utf-8", { fatal: true }).decode(found.data);
    } catch {
      body = new TextDecoder("shift_jis").decode(found.data);
    }
  }
  return new Response(body, {
    headers: {
      "Content-Type": isPdf ? "application/pdf" : "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(found.name)}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
