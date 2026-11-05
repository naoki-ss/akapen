import path from "node:path";
import type { NextRequest } from "next/server";
import { crossSite, uploadEnabled } from "@/lib/jobs";
import {
  KNOWLEDGE_TYPES,
  MAX_KNOWLEDGE_BYTES,
  prepareImport,
} from "@/lib/knowledge";

const error = (message: string, status: number) =>
  Response.json({ error: message }, { status });

// ファイルを受け取り、費用の見込みを返す。AIはまだ呼ばない
export async function POST(request: NextRequest) {
  if (!uploadEnabled()) return error("この環境では追加できません", 403);
  if (crossSite(request))
    return error("別のサイトからの送信は受け付けません", 403);
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return error("ファイルを選んでください", 400);
  if (file.size > MAX_KNOWLEDGE_BYTES)
    return error("ファイルが大きすぎます（20MBまで）", 413);
  if (!KNOWLEDGE_TYPES.includes(path.extname(file.name).toLowerCase())) {
    return error("Excel・CSV・PDF・テキストのファイルを選んでください", 400);
  }
  try {
    return Response.json(
      await prepareImport(Buffer.from(await file.arrayBuffer()), file.name),
    );
  } catch (failure) {
    return error((failure as Error).message, 400);
  }
}
