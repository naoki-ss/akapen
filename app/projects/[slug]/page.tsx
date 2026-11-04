import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import ModelConsole from "@/components/screens/ModelConsole";
import { getBuilding, listBuildings } from "@/lib/buildings";
import { uploadEnabled } from "@/lib/jobs";
import { knowledgeApps, projectDocuments } from "@/lib/projects";

async function Content({ params }: PageProps<"/projects/[slug]">) {
  await connection();
  const { slug } = await params;
  const building = getBuilding(slug);
  if (!building) notFound();
  const enabled = uploadEnabled();
  return (
    <ModelConsole
      {...building}
      projects={listBuildings().map((b) => ({
        slug: b.slug,
        name: b.model.name,
      }))}
      canUpload={enabled}
      knowledge={enabled ? knowledgeApps() : []}
      documents={enabled ? projectDocuments(slug) : []}
    />
  );
}

// ③ 3Dモデル＋コンソール
export default function Page(props: PageProps<"/projects/[slug]">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
