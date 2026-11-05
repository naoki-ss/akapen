import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import ProjectFrame from "@/components/ProjectFrame";
import MinutesTab from "@/components/screens/MinutesTab";
import { getBuilding } from "@/lib/buildings";
import { uploadEnabled } from "@/lib/jobs";
import { listMinutes } from "@/lib/minutes";

async function Content({ params }: PageProps<"/projects/[slug]/minutes">) {
  await connection();
  const { slug } = await params;
  const building = getBuilding(slug);
  if (!building) notFound();
  const enabled = uploadEnabled();
  return (
    <ProjectFrame slug={slug} name={building.model.name} tab="minutes">
      <MinutesTab slug={slug} rows={enabled ? listMinutes(slug) : []} canCreate={enabled} />
    </ProjectFrame>
  );
}

// 現場トップ：議事録のタブ
export default function Page(props: PageProps<"/projects/[slug]/minutes">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
