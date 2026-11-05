import type { NextRequest } from "next/server";
import { crossSite, uploadEnabled } from "@/lib/jobs";
import { commitSet, proposeSet, readTitles, validIds } from "@/lib/ledger";

const error = (message: string, status: number) =>
  Response.json({ error: message }, { status });

// action が read-titles なら読めないページの図名をAIで読み、案を返し直す。commit なら台帳に入れる
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/projects/[slug]/ledger/[id]">,
) {
  const { slug, id } = await ctx.params;
  if (!uploadEnabled() || crossSite(request) || !validIds(slug, id))
    return error("この環境では入れられません", 403);
  const body = await request.json();
  try {
    if (body.action === "read-titles") {
      await readTitles(slug, id);
      return Response.json({ proposal: await proposeSet(slug, id) });
    }
    await commitSet(slug, id, { label: body.label, date: body.date, assign: body.assign });
    return Response.json({ ok: true });
  } catch (failure) {
    return error((failure as Error).message, 400);
  }
}
