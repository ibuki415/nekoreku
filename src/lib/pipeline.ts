// 撮った写真 → 猫を探す → 背景を消す → ステッカー にする一連の処理
import { cutout } from "./cutout";
import { detectInImage } from "./detector";
import { fitLongEdge, makeSticker, trimTransparent } from "./sticker";

export type Stage = "detect" | "download" | "cutout" | "finish";
export type PipelineProgress = { stage: Stage; percent: number };

export type PipelineResult =
  | { status: "ok"; sticker: Blob }
  | { status: "no-cat" };

const MAX_SOURCE = 2048; // 読み込み時の長辺上限（大きすぎると重いので）
const MAX_STICKER = 720; // ステッカーの長辺
const MARGIN = 0.2; // 猫の枠を上下左右に20%広げる

function toBlob(canvas: HTMLCanvasElement, type: string, q?: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像の変換に失敗しました"))), type, q),
  );
}

/**
 * @param force true なら猫が見つからなくても写真全体を切り抜く
 */
export async function processPhoto(
  source: Blob,
  onProgress: (p: PipelineProgress) => void,
  force = false,
): Promise<PipelineResult> {
  // 1) 読み込み。imageOrientation で写真の向き(EXIF)を反映し、大きければ縮小する
  onProgress({ stage: "detect", percent: 0 });
  const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  const s = Math.min(1, MAX_SOURCE / Math.max(bitmap.width, bitmap.height));
  const base = document.createElement("canvas");
  base.width = Math.round(bitmap.width * s);
  base.height = Math.round(bitmap.height * s);
  base.getContext("2d")!.drawImage(bitmap, 0, 0, base.width, base.height);
  bitmap.close();

  // 2) 猫を探す。見つかったらその周りだけ切り出す（精度UP・人や物が混ざりにくい）
  let target = base;
  let detected: Awaited<ReturnType<typeof detectInImage>> = null;
  try {
    detected = await detectInImage(base);
  } catch {
    // 検出AIが使えなくても、切り抜き自体はできるので続行する
    detected = null;
  }
  if (detected) {
    const { x, y, w, h } = detected.box;
    const x0 = Math.max(0, Math.floor(x - w * MARGIN));
    const y0 = Math.max(0, Math.floor(y - h * MARGIN));
    const x1 = Math.min(base.width, Math.ceil(x + w * (1 + MARGIN)));
    const y1 = Math.min(base.height, Math.ceil(y + h * (1 + MARGIN)));
    target = document.createElement("canvas");
    target.width = x1 - x0;
    target.height = y1 - y0;
    target.getContext("2d")!.drawImage(base, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
  } else if (!force) {
    return { status: "no-cat" };
  }

  // 3) 背景除去
  const input = await toBlob(target, "image/jpeg", 0.92);
  onProgress({ stage: "download", percent: 0 });
  const cut = await cutout(input, (key, current, total) => {
    if (!total) return;
    const percent = Math.round((current / total) * 100);
    if (key.startsWith("fetch")) onProgress({ stage: "download", percent });
    else onProgress({ stage: "cutout", percent });
  });

  // 4) 透明な余白を切り落として、長辺 720px に収める
  onProgress({ stage: "finish", percent: 100 });
  const cutBitmap = await createImageBitmap(cut);
  const cutCanvas = document.createElement("canvas");
  cutCanvas.width = cutBitmap.width;
  cutCanvas.height = cutBitmap.height;
  cutCanvas.getContext("2d")!.drawImage(cutBitmap, 0, 0);
  cutBitmap.close();
  const trimmed = fitLongEdge(trimTransparent(cutCanvas), MAX_STICKER);

  // 5) 白フチ・影つきステッカーに
  const sticker = await makeSticker(trimmed);
  return { status: "ok", sticker };
}
