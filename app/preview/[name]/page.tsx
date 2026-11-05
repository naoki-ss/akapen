import { Suspense } from "react";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import MeetingScreen from "@/components/screens/MeetingScreen";
import { uploadEnabled } from "@/lib/jobs";
import type { BuildingModel } from "@/lib/model";

// 非公開フォルダの試験の結果を、手元で見るための画面。現場一覧には出さず、公開する環境では開けない
async function Content({ params }: PageProps<"/preview/[name]">) {
  await connection();
  const { name } = await params;
  const file = path.join(homedir(), "sekozu-data", "private", name, "model.json");
  if (!uploadEnabled() || !/^[\w-]+$/.test(name) || !existsSync(file)) notFound();
  const model = JSON.parse(readFileSync(file, "utf8")) as BuildingModel;
  return <MeetingScreen slug={name} model={{ ...model, name: "試験" }} canRecord={false} />;
}

export default function Page(props: PageProps<"/preview/[name]">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
