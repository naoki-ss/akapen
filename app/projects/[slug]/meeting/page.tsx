import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import MeetingScreen from "@/components/screens/MeetingScreen";
import { getBuilding } from "@/lib/buildings";
import { uploadEnabled } from "@/lib/jobs";

async function Content({ params }: PageProps<"/projects/[slug]/meeting">) {
  await connection();
  const building = getBuilding((await params).slug);
  if (!building) notFound();
  return <MeetingScreen slug={building.slug} model={building.model} canRecord={uploadEnabled()} />;
}

// ⑤ 打ち合わせモード
export default function Page(props: PageProps<"/projects/[slug]/meeting">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
