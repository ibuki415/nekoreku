import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import TabBar from "@/components/TabBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "ネコレク",
  description: "街の猫を撮って、ステッカーにして集めるアプリ",
  // iPhone で「ホーム画面に追加」したときにアプリっぽく全画面で開く設定
  appleWebApp: {
    capable: true,
    title: "ネコレク",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // iPhone のノッチ部分まで画面を使う
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        {/* 画面下の固定タブバー（現在のURLを読むので Suspense で包む） */}
        <Suspense fallback={null}>
          <TabBar />
        </Suspense>
      </body>
    </html>
  );
}
