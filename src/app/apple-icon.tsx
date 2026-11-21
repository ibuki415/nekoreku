import { ImageResponse } from "next/og";

// iPhone のホーム画面アイコン(PNG 180x180)をビルド時に自動生成する
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0b0b0c",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "10px solid #ffd400",
        }}
      >
        {/* 外部の絵文字画像を取りに行かないよう、図形だけで描く */}
        <div style={{ width: 90, height: 72, borderRadius: 45, background: "#f5f5f4" }} />
      </div>
    ),
    size,
  );
}
