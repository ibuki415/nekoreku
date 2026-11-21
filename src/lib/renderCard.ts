// シェア用のカード画像（1080x1440 の PNG）を Canvas で描く。
// 画面の CatCard と同じ構成：上70%がギンガムチェック＋ステッカー、下30%が白い情報パネル。
// 位置は place_name（地名）だけを載せ、正確な座標は入れない。
import { drawGingham } from "./patterns";
import { relativeTime } from "./time";

export type CardImageInput = {
  name: string;
  sticker: Blob;
  patternId: string;
  caughtAt: string;
  placeName: string;
  ownerName: string;
  collectCount?: number;
};

const W = 1080;
const H = 1440;
const RADIUS = 89; // 画面の角丸 28px を 1080 幅に拡大した値
const FONT = `"Hiragino Sans", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif`;

/** 長い文字列を幅に収まるよう「…」で切る */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxWidth) s = s.slice(0, -1);
  return s + "…";
}

export async function renderCardImage(input: CardImageInput): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas を使えません");

  const topH = Math.round(H * 0.7);

  // カード全体を角丸でくり抜く（外側は透明）
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, RADIUS);
  ctx.clip();

  // 上：チェック柄（画面の cell 22px を拡大して見た目を揃える）
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, topH);
  ctx.clip();
  drawGingham(ctx, input.patternId, W, topH, 70);
  ctx.restore();

  // ステッカー：中央に少し回転させて置く（最大でエリアの82%）
  const bmp = await createImageBitmap(input.sticker);
  const maxW = W * 0.82 * 0.88;
  const maxH = topH * 0.82 * 0.88;
  const scale = Math.min(maxW / bmp.width, maxH / bmp.height);
  const sw = bmp.width * scale;
  const sh = bmp.height * scale;
  ctx.save();
  ctx.translate(W / 2, topH / 2);
  ctx.rotate((-4 * Math.PI) / 180);
  ctx.drawImage(bmp, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
  bmp.close();

  // 下：白い情報パネル
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, topH, W, H - topH);

  const padX = 56;
  const textW = W - padX * 2;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#292524";
  ctx.font = `800 62px ${FONT}`;
  ctx.fillText(fitText(ctx, input.name, textW), padX, topH + 92);

  ctx.fillStyle = "#78716c";
  ctx.font = `500 36px ${FONT}`;
  ctx.fillText(fitText(ctx, `${input.ownerName}がキャッチ`, textW), padX, topH + 148);

  ctx.font = `500 34px ${FONT}`;
  const meta = [relativeTime(input.caughtAt), input.placeName];
  if (input.collectCount !== undefined) meta.push(`他${input.collectCount}人が集めた`);
  ctx.fillText(fitText(ctx, meta.join("   ・   "), textW), padX, topH + 214);

  // 右下に小さくアプリ名
  ctx.textAlign = "right";
  ctx.fillStyle = "#d6d3d1";
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText("ネコレク", W - padX, H - 36);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像を作れませんでした"))), "image/png");
  });
}

/** 画像を作って共有する。共有できない環境ではダウンロードにする。戻り値: "shared" | "downloaded" | "cancelled" */
export async function shareCardImage(
  input: CardImageInput,
): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await renderCardImage(input);
  const file = new File([blob], "nekoreku-cat.png", { type: "image/png" });
  const text = `${input.name} を見つけたよ！ #ネコレク`;

  if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return "shared";
    } catch (e) {
      // 共有シートを閉じただけなら失敗扱いにしない
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      // それ以外はダウンロードにフォールバック
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "nekoreku-cat.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "downloaded";
}
