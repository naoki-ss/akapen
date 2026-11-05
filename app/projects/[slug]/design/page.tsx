import Skeleton from "@/components/Skeleton";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import ProjectFrame from "@/components/ProjectFrame";
import DesignTab from "@/components/screens/DesignTab";
import { getBuilding } from "@/lib/buildings";
import { uploadEnabled } from "@/lib/jobs";
import { modelStatus, readLedger } from "@/lib/ledger";

async function Content({ params }: PageProps<"/projects/[slug]/design">) {
  await connection();
  const { slug } = await params;
  const building = getBuilding(slug);
  if (!building) notFound();
  const enabled = uploadEnabled();
  return (
    <ProjectFrame slug={slug} name={building.model.name} tab="design">
      <DesignTab
        slug={slug}
        ledger={readLedger(slug)}
        canAdd={enabled}
        model={enabled ? modelStatus(slug) : { status: null, changes: null }}
      />
    </ProjectFrame>
  );
}

// 現場トップ：設計図書のタブ
export default function Page(props: PageProps<"/projects/[slug]/design">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content {...props} />
    </Suspense>
  );
}
