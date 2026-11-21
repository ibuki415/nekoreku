// ギンガムチェックの柄定義。CSS 版（画面表示）と Canvas 版（シェア画像）を同じ定義から作る
import type { CSSProperties } from "react";

export const PATTERNS = [
  { id: "green-yellow", label: "グリーン×イエロー", a: "#5cb85c", b: "#ffe066" },
  { id: "pink-white", label: "ピンク×ホワイト", a: "#ff8fb1", b: "#ffffff" },
  { id: "blue-white", label: "ブルー×ホワイト", a: "#5aa9e6", b: "#ffffff" },
  { id: "orange-cream", label: "オレンジ×クリーム", a: "#ff9f43", b: "#fff4dc" },
  { id: "purple-mint", label: "パープル×ミント", a: "#a685e2", b: "#c8f7dc" },
  { id: "red-white", label: "レッド×ホワイト", a: "#ef5b5b", b: "#ffffff" },
] as const;

export type PatternId = (typeof PATTERNS)[number]["id"];

const STRIPE_ALPHA = 0.55; // 縞の濃さ（縦と横が重なる交点がさらに濃くなる）

export function getPattern(id: string) {
  return PATTERNS.find((p) => p.id === id) ?? PATTERNS[0];
}

/** ランダムに柄を1つ選ぶ */
export function randomPatternId(): PatternId {
  return PATTERNS[Math.floor(Math.random() * PATTERNS.length)].id;
}

/** 次の柄（タップで切り替える用） */
export function nextPatternId(id: string): PatternId {
  const i = PATTERNS.findIndex((p) => p.id === id);
  return PATTERNS[(i + 1) % PATTERNS.length].id;
}

function hexToRgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** CSS 版：地色 b の上に、半透明の縦縞・横縞を重ねる */
export function ginghamStyle(id: string, cell = 22): CSSProperties {
  const { a, b } = getPattern(id);
  const stripe = hexToRgba(a, STRIPE_ALPHA);
  const half = cell / 2;
  const line = (deg: number) =>
    `repeating-linear-gradient(${deg}deg, ${stripe} 0 ${half}px, transparent ${half}px ${cell}px)`;
  return { backgroundColor: b, backgroundImage: `${line(90)}, ${line(0)}` };
}

/** Canvas 版：シェア画像用。ginghamStyle と同じ見た目になるよう描く */
export function drawGingham(
  ctx: CanvasRenderingContext2D,
  id: string,
  w: number,
  h: number,
  cell = 22,
) {
  const { a, b } = getPattern(id);
  ctx.save();
  ctx.fillStyle = b;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = hexToRgba(a, STRIPE_ALPHA);
  for (let x = 0; x < w; x += cell) ctx.fillRect(x, 0, cell / 2, h); // 縦縞
  for (let y = 0; y < h; y += cell) ctx.fillRect(0, y, w, cell / 2); // 横縞
  ctx.restore();
}
