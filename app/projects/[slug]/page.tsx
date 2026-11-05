import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import ProjectFrame from "@/components/ProjectFrame";
import SheetsTab from "@/components/screens/SheetsTab";
import { drawingResults, getBuilding } from "@/lib/buildings";
import { isBlue } from "@/lib/findings";
import { uploadEnabled } from "@/lib/jobs";
import { shopSheets } from "@/lib/sheetStatus";

async function Content({ params }: PageProps<"/projects/[slug]">) {
  await connection();
  const { slug } = await params;
  const building = getBuilding(slug);
  if (!building) notFound();
  const enabled = uploadEnabled();
  const saved = drawingResults(building).map((item) => {
    const blue = item.findings.filter(isBlue).length;
    return { title: item.title, job: item.job, red: item.findings.length - blue, blue };
  });
  return (
    <ProjectFrame slug={slug} name={building.model.name} tab="sheets">
      <SheetsTab
        slug={slug}
        shop={enabled ? shopSheets(slug) : []}
        saved={saved}
        canUpload={enabled}
      />
    </ProjectFrame>
  );
}

// 現場トップ：施工図のタブ
export default function Page(props: PageProps<"/projects/[slug]">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
