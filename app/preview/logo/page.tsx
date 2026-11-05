import LogoIntro from "@/components/LogoIntro";

export const metadata = { title: "アカペン" };

// 動画の冒頭と締めに使う、ロゴの動きだけの画面。開くたびに再生し、ロゴを押すともう一度
export default function Page() {
  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "var(--bg)",
      }}
    >
      <LogoIntro replay large />
    </main>
  );
}
