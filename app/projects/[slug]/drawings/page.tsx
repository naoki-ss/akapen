import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import LedgerScreen from "@/components/screens/LedgerScreen";
import { getBuilding } from "@/lib/buildings";
import { uploadEnabled } from "@/lib/jobs";
import { readLedger } from "@/lib/ledger";

async function Content({ params }: PageProps<"/projects/[slug]/drawings">) {
  await connection();
  const { slug } = await params;
  const building = getBuilding(slug);
  if (!building) notFound();
  return (
    <LedgerScreen
      slug={slug}
      name={building.model.name}
      ledger={readLedger(slug)}
      canAdd={uploadEnabled()}
    />
  );
}

// 図面台帳
export default function Page(props: PageProps<"/projects/[slug]/drawings">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
