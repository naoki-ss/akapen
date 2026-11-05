"use client";

import dynamic from "next/dynamic";
import Skeleton from "./Skeleton";

// WebGL はブラウザでしか動かないので、サーバー側では描画しない
const BuildingSceneLazy = dynamic(() => import("./BuildingScene"), {
  ssr: false,
  loading: () => <Skeleton />,
});

export default BuildingSceneLazy;
