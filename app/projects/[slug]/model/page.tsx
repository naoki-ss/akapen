import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import ProjectFrame from "@/components/ProjectFrame";
import ModelConsole from "@/components/screens/ModelConsole";
import { drawingResults, getBuilding } from "@/lib/buildings";
import { uploadEnabled } from "@/lib/jobs";
import { confirmedSheets } from "@/lib/sheetStatus";

async function Content({ params }: PageProps<"/projects/[slug]/model">) {
  await connection();
  const { slug } = await params;
  const building = getBuilding(slug);
  if (!building) notFound();
  return (
    <ProjectFrame slug={slug} name={building.model.name} tab="model">
      <ModelConsole
        {...building}
        drawings={drawingResults(building)}
        confirmedSheets={uploadEnabled() ? confirmedSheets(slug) : []}
      />
    </ProjectFrame>
  );
}

// 現場トップ：建物3Dのタブ
export default function Page(props: PageProps<"/projects/[slug]/model">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
