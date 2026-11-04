import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import RegisterScreen from "@/components/screens/RegisterScreen";
import { listBuildings } from "@/lib/buildings";
import { uploadEnabled } from "@/lib/jobs";
import { maskChoices } from "@/lib/projects";

async function Content() {
  await connection();
  if (!uploadEnabled()) notFound();
  const buildings = listBuildings();
  return (
    <RegisterScreen
      maskChoices={maskChoices().map((choice) => ({
        ...choice,
        name:
          buildings.find((b) => b.slug === choice.slug)?.model.name ??
          choice.name,
      }))}
    />
  );
}

// ② プロジェクト登録
export default function Page() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
