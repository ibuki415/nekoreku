// 猫の検出（MediaPipe ObjectDetector）。ブラウザ専用なので、ライブラリは必要になった時に import する
import type { ObjectDetector } from "@mediapipe/tasks-vision";
import type { Rect } from "./coverMap";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";

export type CatDetection = { score: number; box: Rect };

type Mode = "VIDEO" | "IMAGE";

// モード別に1つだけ作って使い回す（作成は重いので Promise ごと保持）
const instances: Partial<Record<Mode, Promise<ObjectDetector>>> = {};

async function create(mode: Mode): Promise<ObjectDetector> {
  const { FilesetResolver, ObjectDetector } = await import("@mediapipe/tasks-vision");
  // wasm は public/mediapipe-wasm に置いた自前のものを使う（scripts/copy-assets.mjs がコピー）
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe-wasm");
  const make = (delegate: "GPU" | "CPU") =>
    ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: mode,
      categoryAllowlist: ["cat"],
      scoreThreshold: 0.3,
      maxResults: 1,
    });
  try {
    return await make("GPU");
  } catch {
    // GPU が使えない端末では CPU でやり直す
    return await make("CPU");
  }
}

function get(mode: Mode) {
  if (!instances[mode]) {
    const p = create(mode);
    // 失敗したら次回また試せるように捨てる
    p.catch(() => {
      delete instances[mode];
    });
    instances[mode] = p;
  }
  return instances[mode]!;
}

type DetectionLike = {
  categories: { score: number }[];
  boundingBox?: { originX: number; originY: number; width: number; height: number };
};

function pick(detections: DetectionLike[]): CatDetection | null {
  const d = detections[0];
  if (!d?.boundingBox) return null;
  const b = d.boundingBox;
  return {
    score: d.categories[0]?.score ?? 0,
    box: { x: b.originX, y: b.originY, w: b.width, h: b.height },
  };
}

/** 動画用の検出器（準備ができたら返る） */
export function getVideoDetector() {
  return get("VIDEO");
}

let lastTs = 0;
/** 動画の1フレームから猫を探す。タイムスタンプは必ず前より大きくする */
export function detectInVideo(detector: ObjectDetector, video: HTMLVideoElement) {
  const ts = Math.max(performance.now(), lastTs + 1);
  lastTs = ts;
  return pick(detector.detectForVideo(video, ts).detections);
}

/** 静止画から猫を探す（見つからなければ null） */
export async function detectInImage(
  source: HTMLCanvasElement | ImageBitmap | HTMLImageElement,
): Promise<CatDetection | null> {
  const detector = await get("IMAGE");
  return pick(detector.detect(source).detections);
}
