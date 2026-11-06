import TopPage from "@/components/TopPage";

export const metadata = { title: "アカペン" };

// 動画の冒頭と締めに使う、トップの表示の動きの確認用。開くたびに再生し、右下の「もう一度再生」でもう一度
export default function Page() {
  return <TopPage replay />;
}
