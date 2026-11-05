import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import CheckScreen from "@/components/screens/CheckScreen";
import { getBuilding } from "@/lib/buildings";
import { jobFolder, jobStale, uploadEnabled } from "@/lib/jobs";
import { confirmedPages } from "@/lib/sheetStatus";

type Props = PageProps<"/projects/[slug]/check/[job]">;

async function Content({ params }: Props) {
  await connection();
  const { slug, job } = await params;
  const building = getBuilding(slug);
  if (!building) notFound();
  if (job === "saved" && !building.check) notFound();
  const stale = job !== "saved" && uploadEnabled() ? jobStale(slug, job) : [];
  const folder = job !== "saved" && uploadEnabled() ? jobFolder(job) : null;
  return (
    <CheckScreen
      key={job}
      {...building}
      job={job}
      stale={stale}
      confirmed={folder ? confirmedPages(folder) : []}
    />
  );
}

// ④ 施工図の朱書きと根拠。job は判定ジョブのID、saved はデモ用に固定した結果
export default function Page(props: Props) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
