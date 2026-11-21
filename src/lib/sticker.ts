// 切り抜き画像を「白フチ＋影つきステッカー」にする

/** 透明な余白を切り落とす（alpha > 16 の外接矩形）。何も無ければそのまま返す */
export function trimTransparent(src: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = src.getContext("2d", { willReadFrequently: true })!;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return src;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d")!.drawImage(src, minX, minY, w, h, 0, 0, w, h);
  return out;
}

/** 長辺が max を超えるときだけ縮小する */
export function fitLongEdge(src: HTMLCanvasElement, max: number): HTMLCanvasElement {
  const long = Math.max(src.width, src.height);
  if (long <= max) return src;
  const s = max / long;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(src.width * s));
  out.height = Math.max(1, Math.round(src.height * s));
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

/** ステッカー化して PNG Blob を返す */
export function makeSticker(src: HTMLCanvasElement): Promise<Blob> {
  const long = Math.max(src.width, src.height);
  const border = Math.max(8, Math.round(long * 0.022)); // 白フチの太さ
  const blur = 18;
  const offsetY = 8;
  // 白フチ・影がはみ出してもいいように余白をとる
  const pad = border + blur + 4;
  const w = src.width + pad * 2;
  const h = src.height + pad * 2 + offsetY;

  // 1) 元の形を真っ白に塗りつぶしたシルエットを作る
  const white = document.createElement("canvas");
  white.width = src.width;
  white.height = src.height;
  const wctx = white.getContext("2d")!;
  wctx.drawImage(src, 0, 0);
  wctx.globalCompositeOperation = "source-in";
  wctx.fillStyle = "#fff";
  wctx.fillRect(0, 0, white.width, white.height);

  // 2) シルエットを円周 32 方向にずらして重ねる → 輪郭が太る（内側にもう1周足して隙間を埋める）
  const outline = document.createElement("canvas");
  outline.width = w;
  outline.height = h;
  const octx = outline.getContext("2d")!;
  const cx = pad;
  const cy = pad;
  const STEPS = 32;
  for (const r of [border, border * 0.55]) {
    for (let i = 0; i < STEPS; i++) {
      const a = (i / STEPS) * Math.PI * 2 + (r === border ? 0 : Math.PI / STEPS);
      octx.drawImage(white, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  }
  octx.drawImage(white, cx, cy);

  // 3) 影つきで白フチを描き、その上に元の切り抜きを重ねる
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = offsetY;
  ctx.drawImage(outline, 0, 0);
  ctx.shadowColor = "transparent";
  ctx.drawImage(src, cx, cy);

  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("画像の作成に失敗しました"))), "image/png"),
  );
}
