import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import ModelConsole from "@/components/screens/ModelConsole";
import { getBuilding } from "@/lib/buildings";

async function Content({ params }: PageProps<"/projects/[slug]">) {
  await connection();
  const building = getBuilding((await params).slug);
  if (!building) notFound();
  return <ModelConsole {...building} />;
}

// ③ 3Dモデル＋コンソール
export default function Page(props: PageProps<"/projects/[slug]">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
