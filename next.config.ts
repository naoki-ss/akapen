import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // デモの録画に開発用のマークが映らないようにする
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
