import { Suspense } from "react";
import { connection } from "next/server";
import ProjectList from "@/components/screens/ProjectList";
import { listBuildings } from "@/lib/buildings";
import { uploadEnabled } from "@/lib/jobs";

async function Content() {
  await connection();
  const projects = listBuildings().map(({ slug, model }) => ({
    slug,
    name: model.name,
    hasModel: model.members.length > 0,
  }));
  return <ProjectList projects={projects} canRegister={uploadEnabled()} />;
}

// ① プロジェクト一覧
export default function Page() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
