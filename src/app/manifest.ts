import type { MetadataRoute } from "next";

// PWA の「名刺」。ホーム画面に追加したときの名前・色・アイコンを決める
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ネコレク",
    short_name: "ネコレク",
    description: "街の猫を撮って、ステッカーにして集めるアプリ",
    start_url: "/camera", // ホーム画面から開いたら、すぐカメラ
    display: "standalone",
    background_color: "#0b0b0c",
    theme_color: "#0b0b0c",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
