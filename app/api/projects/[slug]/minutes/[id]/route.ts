import type { NextRequest } from "next/server";
import { crossSite, uploadEnabled } from "@/lib/jobs";
import {
  cleanMinutes,
  deleteMinutes,
  readMinutes,
  saveMinutes,
} from "@/lib/minutes";

const error = (message: string, status: number) =>
  Response.json({ error: message }, { status });

// 議事録を直す
export async function PUT(
  request: NextRequest,
  ctx: RouteContext<"/api/projects/[slug]/minutes/[id]">,
) {
  const { slug, id } = await ctx.params;
  if (!uploadEnabled() || crossSite(request) || !readMinutes(slug, id))
    return error("変更できません", 403);
  const minutes = cleanMinutes(await request.json());
  if (!minutes) return error("題名と日付を入れてください", 400);
  saveMinutes(slug, id, minutes);
  return Response.json({ ok: true });
}

// 議事録を消す
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/projects/[slug]/minutes/[id]">,
) {
  const { slug, id } = await ctx.params;
  if (!uploadEnabled() || crossSite(request) || !readMinutes(slug, id))
    return error("変更できません", 403);
  deleteMinutes(slug, id);
  return Response.json({ ok: true });
}
