"use client";

import { useRouter, useSearchParams } from "next/navigation";
import AppFrame from "../AppFrame";
import RegisterView from "../RegisterView";

// ② プロジェクト登録
export default function RegisterScreen({
  maskChoices,
}: {
  maskChoices: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const watch = useSearchParams().get("watch");
  return (
    <AppFrame
      crumbs={[
        { label: "現場を選ぶ", href: "/" },
        { label: "新しい現場をつくる" },
      ]}
    >
      <RegisterView
        maskChoices={maskChoices}
        watch={watch}
        onCancel={() => router.push("/")}
        onDone={(slug) => router.push(`/projects/${slug}/model`)}
      />
    </AppFrame>
  );
}
