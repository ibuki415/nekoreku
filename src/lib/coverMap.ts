// object-fit: cover で表示された動画上の座標を計算する純粋関数。
// 動画(例 1920x1080)を画面(例 390x844)いっぱいに「はみ出して」表示すると、
// 拡大され、左右(または上下)が切れる。その分を考慮して bbox を画面座標へ変換する。

export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

/** 動画の座標 → 表示領域の座標へ変換する */
export function coverMapRect(box: Rect, video: Size, view: Size): Rect {
  // 余白なく覆うため、大きい方の倍率を採用する
  const scale = Math.max(view.w / video.w, view.h / video.h);
  // 拡大後の動画サイズと、中央寄せによるはみ出し量
  const offsetX = (view.w - video.w * scale) / 2;
  const offsetY = (view.h - video.h * scale) / 2;
  return {
    x: box.x * scale + offsetX,
    y: box.y * scale + offsetY,
    w: box.w * scale,
    h: box.h * scale,
  };
}
