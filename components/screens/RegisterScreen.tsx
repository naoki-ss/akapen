"use client";

import { useRouter } from "next/navigation";
import AppFrame from "../AppFrame";
import RegisterView from "../RegisterView";

// ② プロジェクト登録
export default function RegisterScreen({
  maskChoices,
}: {
  maskChoices: { slug: string; name: string }[];
}) {
  const router = useRouter();
  return (
    <AppFrame
      crumbs={[
        { label: "プロジェクト一覧", href: "/" },
        { label: "新しいプロジェクトを登録" },
      ]}
    >
      <RegisterView
        maskChoices={maskChoices}
        onCancel={() => router.push("/")}
        onDone={(slug) => router.push(`/projects/${slug}`)}
      />
    </AppFrame>
  );
}
