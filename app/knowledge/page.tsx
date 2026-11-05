import Skeleton from "@/components/Skeleton";
import { connection } from "next/server";
import { Suspense } from "react";
import KnowledgeScreen from "@/components/screens/KnowledgeScreen";
import { uploadEnabled } from "@/lib/jobs";
import { listKnowledge } from "@/lib/knowledge";
import kinds from "@/scripts/check/drawing_kinds.json";

async function Content() {
  await connection();
  const enabled = uploadEnabled();
  return (
    <KnowledgeScreen
      enabled={enabled}
      rows={enabled ? await listKnowledge() : []}
      kinds={["すべての図面", kinds.steel, ...kinds.kinds.map((kind) => kind.name)]}
    />
  );
}

// ナレッジ。環境で共通で、物件の外から開く
export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content />
    </Suspense>
  );
}
