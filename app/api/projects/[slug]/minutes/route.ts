import type { NextRequest } from "next/server";
import { crossSite, uploadEnabled } from "@/lib/jobs";
import {
  cleanMinutes,
  MAX_MINUTES_CHARS,
  organizeMinutes,
  saveMinutes,
  validSlug,
} from "@/lib/minutes";

const error = (message: string, status: number) =>
  Response.json({ error: message }, { status });

// action が organize なら文章を整理して返す（保存しない）。それ以外は議事録を保存する
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/projects/[slug]/minutes">,
) {
  const { slug } = await ctx.params;
  if (!uploadEnabled() || crossSite(request) || !validSlug(slug))
    return error("この環境では議事録を作れません", 403);
  const body = await request.json();
  if (body.action === "organize") {
    const text = String(body.text ?? "").trim();
    if (!text) return error("文章がありません", 400);
    if (text.length > MAX_MINUTES_CHARS) return error("文章が長すぎます", 413);
    try {
      return Response.json(await organizeMinutes(text));
    } catch (failure) {
      return error((failure as Error).message, 500);
    }
  }
  const minutes = cleanMinutes(body);
  if (!minutes) return error("題名と日付を入れてください", 400);
  return Response.json({ id: saveMinutes(slug, null, minutes) });
}
