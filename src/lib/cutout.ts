// 背景除去（@imgly/background-removal）。AIモデルは初回だけダウンロードされる（約40MB）

// key は "fetch:..."（ダウンロード中）や "compute:inference"（計算中）などが来る
export type CutoutProgress = (key: string, current: number, total: number) => void;

const MODEL = "isnet_quint8" as const;

/** 撮影画面を開いたあと、裏でモデルを先に読み込んでおく（失敗しても無視） */
export async function preloadCutout() {
  try {
    const { preload } = await import("@imgly/background-removal");
    await preload({ model: MODEL });
  } catch {
    /* 先読みなので失敗しても何もしない */
  }
}

/** 画像から背景を消して、透明PNGのBlobを返す */
export async function cutout(source: Blob, onProgress?: CutoutProgress): Promise<Blob> {
  const { removeBackground } = await import("@imgly/background-removal");
  return removeBackground(source, {
    model: MODEL,
    output: { format: "image/png" },
    progress: (key: string, current: number, total: number) => onProgress?.(key, current, total),
  });
}
