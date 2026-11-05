import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import KnowledgeScreen from "@/components/screens/KnowledgeScreen";
import { listBuildings } from "@/lib/buildings";
import { uploadEnabled } from "@/lib/jobs";
import kinds from "@/scripts/check/drawing_kinds.json";

async function Content({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  await connection();
  if (!uploadEnabled()) notFound();
  const { from } = await searchParams;
  const project = listBuildings().find((item) => item.slug === from);
  return (
    <KnowledgeScreen
      kinds={[kinds.steel, ...kinds.kinds.map((kind) => kind.name)]}
      back={
        project ? { href: `/projects/${project.slug}`, label: project.model.name } : null
      }
    />
  );
}

// ナレッジを追加する
export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  return (
    <Suspense>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
