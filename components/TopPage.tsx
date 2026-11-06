import { Suspense } from "react";
import { connection } from "next/server";
import ProjectList from "@/components/screens/ProjectList";
import { cardOf, listBuildings } from "@/lib/buildings";
import { uploadEnabled } from "@/lib/jobs";
import { runningProjects } from "@/lib/projects";

async function Content({ replay }: { replay: boolean }) {
  await connection();
  const enabled = uploadEnabled();
  return (
    <ProjectList
      projects={listBuildings().map(cardOf)}
      running={enabled ? runningProjects() : []}
      canRegister={enabled}
      replay={replay}
    />
  );
}

// ① プロジェクト一覧。replay は動画用の /preview/logo から使う（開くたびに表示の動きを再生する）
export default function TopPage({ replay = false }: { replay?: boolean }) {
  return (
    <Suspense>
      <Content replay={replay} />
    </Suspense>
  );
}
