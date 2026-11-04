import { Suspense } from "react";
import { connection } from "next/server";
import ProjectList from "@/components/screens/ProjectList";
import { cardOf, listBuildings } from "@/lib/buildings";
import { uploadEnabled } from "@/lib/jobs";
import { runningProjects } from "@/lib/projects";

async function Content() {
  await connection();
  const enabled = uploadEnabled();
  return (
    <ProjectList
      projects={listBuildings().map(cardOf)}
      running={enabled ? runningProjects() : []}
      canRegister={enabled}
    />
  );
}

// ① プロジェクト一覧
export default function Page() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
