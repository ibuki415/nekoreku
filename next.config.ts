import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // 開発中、Cloudflare トンネル経由(https://〇〇.trycloudflare.com)のアクセスを許可する
  allowedDevOrigins: ["*.trycloudflare.com"],
  // トップは撮影画面へ
  async redirects() {
    return [{ source: "/", destination: "/camera", permanent: false }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
