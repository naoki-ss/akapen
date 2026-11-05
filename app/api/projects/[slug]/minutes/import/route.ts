import path from "node:path";
import type { NextRequest } from "next/server";
import { crossSite, uploadEnabled } from "@/lib/jobs";
import { MAX_KNOWLEDGE_BYTES } from "@/lib/knowledge";
import { MINUTES_FILE_TYPES, organizeMinutesFile, validSlug } from "@/lib/minutes";

const error = (message: string, status: number) =>
  Response.json({ error: message }, { status });

// ファイルを読み、打ち合わせの回ごとに整理して返す（保存しない）
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/projects/[slug]/minutes/import">,
) {
  const { slug } = await ctx.params;
  if (!uploadEnabled() || crossSite(request) || !validSlug(slug))
    return error("この環境では議事録を作れません", 403);
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return error("ファイルを選んでください", 400);
  if (file.size > MAX_KNOWLEDGE_BYTES)
    return error("ファイルが大きすぎます（20MBまで）", 413);
  if (!MINUTES_FILE_TYPES.includes(path.extname(file.name).toLowerCase()))
    return error("PDF・Word（.docx）・テキストのファイルを選んでください", 400);
  try {
    return Response.json(
      await organizeMinutesFile(slug, Buffer.from(await file.arrayBuffer()), file.name),
    );
  } catch (failure) {
    return error((failure as Error).message, 500);
  }
}
