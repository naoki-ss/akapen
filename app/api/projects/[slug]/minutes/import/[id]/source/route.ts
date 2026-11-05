import type { NextRequest } from "next/server";
import { uploadEnabled } from "@/lib/jobs";
import { minutesSourceFile } from "@/lib/minutes";

const TYPES: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain; charset=utf-8",
};
// 短い見出しだけの一致は数えない
const MIN_LINE = 6;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"\']/g, (c) => `&#${c.charCodeAt(0)};`);
const plain = (text: string) => text.replace(/\s/g, "");

// Word とテキストはページがないので、読み取った本文の該当箇所をハイライトして見せる
function textPage(name: string, text: string, quote: string, downloadUrl: string) {
  const wanted = plain(quote);
  let first = true;
  const lines = text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const value = plain(line);
      const hit = wanted && value.length >= MIN_LINE && (wanted.includes(value) || value.includes(wanted));
      if (!hit) return `<p>${escapeHtml(line)}</p>`;
      const id = first ? ' id="hit"' : "";
      first = false;
      return `<p${id}><mark>${escapeHtml(line)}</mark></p>`;
    });
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>${escapeHtml(name)}</title>
<style>
body{margin:0 auto;max-width:860px;padding:40px 32px;background:#f6f4ee;color:#141b24;font:15px/1.8 "Noto Sans JP",system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}small{color:#4c5460}a{color:#141b24}p{margin:0 0 6px}
mark{background:#c62d2322;border-left:2px solid #c62d23;padding:2px 6px;color:inherit}
</style>
<h1>${escapeHtml(name)}</h1>
<small>ファイルから読み取った本文です。レイアウトは元のファイルと異なります。<a href="${escapeHtml(downloadUrl)}">元のファイルをダウンロード</a></small>
<hr>${lines.join("\n")}</html>`;
}

// 元のファイルを開く。公開する環境では見せない
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/projects/[slug]/minutes/import/[id]/source">,
) {
  const { slug, id } = await ctx.params;
  const found = uploadEnabled() ? minutesSourceFile(slug, id) : null;
  if (!found) return new Response("見つかりません", { status: 404 });
  const name = encodeURIComponent(found.name);
  if (found.extension === ".pdf") {
    return new Response(new Uint8Array(found.data), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${name}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (request.nextUrl.searchParams.has("download")) {
    return new Response(new Uint8Array(found.data), {
      headers: {
        "Content-Type": TYPES[found.extension] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${name}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const html = textPage(found.name, found.text, request.nextUrl.searchParams.get("q") ?? "", "?download=1");
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
