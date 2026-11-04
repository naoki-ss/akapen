import type { NextRequest } from "next/server";
import { crossSite, jobFolder, startJob, uploadEnabled } from "@/lib/jobs";

const error = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function POST(request: NextRequest, ctx: RouteContext<"/api/check/[id]/start">) {
  if (!uploadEnabled()) return error("この環境では施工図のチェックはできません", 403);
  if (crossSite(request)) return error("別のサイトからの送信は受け付けません", 403);
  const { id } = await ctx.params;
  const folder = jobFolder(id);
  if (!folder) return error("見つかりません", 404);
  const { pages } = (await request.json()) as { pages?: unknown };
  const valid =
    Array.isArray(pages) &&
    pages.length > 0 &&
    pages.every((page) => Number.isInteger(page) && page >= 1);
  if (!valid) return error("判定するページを選んでください", 400);
  if (!startJob(folder, pages)) return error("このチェックはもう始まっています", 409);
  return Response.json({ id });
}
