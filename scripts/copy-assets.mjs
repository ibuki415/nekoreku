// MediaPipe の wasm（AI を動かす部品）を public/ にコピーする。
// 外部 CDN に頼らず自分のサーバーから配るため（npm install / dev / build の前に自動で実行される）
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const to = join(root, "public", "mediapipe-wasm");

if (!existsSync(from)) {
  console.warn("[copy-assets] @mediapipe/tasks-vision が見つかりません。スキップします");
} else {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log("[copy-assets] mediapipe-wasm をコピーしました");
}

// MapLibre の Worker（地図を別スレッドで処理する部品）も同様にコピーする。
// バンドルすると Worker のURLが壊れて地図が出ないため、そのままの形で配る
const mlWorker = join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
if (existsSync(mlWorker)) {
  const mlTo = join(root, "public", "maplibre");
  mkdirSync(mlTo, { recursive: true });
  cpSync(mlWorker, join(mlTo, "maplibre-gl-worker.mjs"));
  console.log("[copy-assets] maplibre-gl-worker をコピーしました");
}
