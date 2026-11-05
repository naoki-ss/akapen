import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import MinutesScreen from "@/components/screens/MinutesScreen";
import { getBuilding } from "@/lib/buildings";
import { uploadEnabled } from "@/lib/jobs";
import { readMinutes } from "@/lib/minutes";

async function Content({ params }: PageProps<"/projects/[slug]/minutes/[id]">) {
  await connection();
  const { slug, id } = await params;
  const building = getBuilding(slug);
  const minutes = uploadEnabled() ? readMinutes(slug, id) : null;
  if (!building || !minutes) notFound();
  return <MinutesScreen slug={slug} name={building.model.name} minutes={minutes} />;
}

// 議事録の全文と編集
export default function Page(props: PageProps<"/projects/[slug]/minutes/[id]">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
