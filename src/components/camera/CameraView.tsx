"use client";
// 撮影画面：全画面のカメラ映像 + 黄色いファインダー + 猫の検出演出 + シャッター

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { coverMapRect, type Rect } from "@/lib/coverMap";
import { preloadCutout } from "@/lib/cutout";
import { latestCat, type CatRecord } from "@/lib/db";
import { detectInVideo, getVideoDetector } from "@/lib/detector";
import { locate, type Located } from "@/lib/geo";
import { ginghamStyle } from "@/lib/patterns";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { ImageIcon } from "../icons";
import CaptureSheet from "./CaptureSheet";

type CamState = "starting" | "ready" | "error";
type AiState = "loading" | "ready" | "failed";
type Capture = { blob: Blob; located: Promise<Located> };

const FOUND_SCORE = 0.45; // このスコア以上なら「猫あり」とみなす
const HITS_TO_FOUND = 3; // 連続3回で「発見」
const MISSES_TO_LOST = 5; // 連続5回外れたら「見失った」
const DETECT_INTERVAL = 125; // 約8fps

function cameraErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (!navigator.mediaDevices?.getUserMedia)
    return "この環境ではカメラを使えません。HTTPS（https://）で開いてください。";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "カメラの使用が許可されていません。ブラウザやiPhoneの設定でカメラを許可してください。";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "カメラが見つかりませんでした。";
  if (name === "NotReadableError") return "カメラが他のアプリで使われているようです。";
  return "カメラを起動できませんでした。";
}

export default function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const capturingRef = useRef(false); // 撮影シートが開いている間は検出を止める

  const [cam, setCam] = useState<CamState>("starting");
  const [camError, setCamError] = useState("");
  const [retry, setRetry] = useState(0);
  const [ai, setAi] = useState<AiState>("loading");
  const [found, setFound] = useState(false);
  const [box, setBox] = useState<Rect | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [latest, setLatest] = useState<CatRecord | null>(null);
  const latestUrl = useObjectUrl(latest?.sticker);

  // ---- カメラ起動（離脱時は track.stop() で必ず止める） ----
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    const video = videoRef.current;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no-camera-api");
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        setCam("ready");
      } catch (e) {
        if (!cancelled) {
          setCamError(cameraErrorMessage(e));
          setCam("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, [retry]);

  // ---- 猫の検出ループ（約8fps） ----
  useEffect(() => {
    if (cam !== "ready") return;
    let stopped = false;
    let raf = 0;
    (async () => {
      let detector;
      try {
        detector = await getVideoDetector();
        if (stopped) return;
        setAi("ready");
      } catch {
        if (!stopped) setAi("failed");
        return;
      }
      let last = 0;
      let hits = 0;
      let misses = 0;
      let isFound = false;
      const loop = (now: number) => {
        if (stopped) return;
        raf = requestAnimationFrame(loop);
        if (now - last < DETECT_INTERVAL) return;
        last = now;
        const v = videoRef.current;
        if (!v || v.readyState < 2 || !v.videoWidth || capturingRef.current) return;
        try {
          const det = detectInVideo(detector, v);
          if (det && det.score >= FOUND_SCORE) {
            hits++;
            misses = 0;
          } else {
            misses++;
            hits = 0;
          }
          if (!isFound && hits >= HITS_TO_FOUND) {
            isFound = true;
            setFound(true);
          } else if (isFound && misses >= MISSES_TO_LOST) {
            isFound = false;
            setFound(false);
            setBox(null);
          }
          // 発見中は、猫の位置を画面座標に直して枠を追従させる（object-cover の拡大・はみ出しを考慮）
          if (isFound && det) {
            const r = v.getBoundingClientRect();
            setBox(
              coverMapRect(det.box, { w: v.videoWidth, h: v.videoHeight }, { w: r.width, h: r.height }),
            );
          }
        } catch {
          /* 1フレームの失敗は無視 */
        }
      };
      raf = requestAnimationFrame(loop);
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [cam]);

  // ---- カメラが映ったあと、暇なときに切り抜きAIを先読みしておく ----
  const preloaded = useRef(false);
  useEffect(() => {
    if (cam !== "ready" || preloaded.current) return;
    preloaded.current = true;
    const run = () => void preloadCutout();
    if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 5000 });
    else setTimeout(run, 2000);
  }, [cam]);

  // ---- 右下サムネ用に最新の1匹を読む（撮影シートを閉じたときも更新） ----
  useEffect(() => {
    if (capture) return;
    let alive = true;
    latestCat()
      .then((c) => alive && setLatest(c ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [capture]);

  // ---- シャッター ----
  const shoot = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || capturingRef.current) return;
    capturingRef.current = true;
    const located = locate(); // 押した瞬間から位置情報の取得を並行して始める
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.92));
    if (!blob) {
      capturingRef.current = false;
      return;
    }
    setFound(false);
    setBox(null);
    setCapture({ blob, located });
  }, []);

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // 同じ写真をもう一度選べるように
    if (!f) return;
    capturingRef.current = true;
    setCapture({ blob: f, located: locate() });
  };

  const closeSheet = () => {
    capturingRef.current = false;
    setCapture(null);
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-black" style={{ height: "100dvh" }}>
      {/* 映像：画面いっぱいに object-cover。iPhone は playsInline 必須 */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* 検出した猫を囲う青い光る枠 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {box && found && (
          <div
            className="cat-box"
            style={{ width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)` }}
          />
        )}
      </div>

      {/* 黄色い四隅ブラケット（発見中は青く光る） */}
      {cam === "ready" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={`finder relative ${found ? "is-found" : ""}`}
            style={{ width: "min(78vw, 60dvh)", height: "min(78vw, 60dvh)" }}
          >
            <span className="bracket bracket-tl" />
            <span className="bracket bracket-tr" />
            <span className="bracket bracket-bl" />
            <span className="bracket bracket-br" />
          </div>
        </div>
      )}

      {/* 上部の案内文 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-1 px-6 pt-[calc(env(safe-area-inset-top)+16px)] text-center">
        {cam === "ready" && (
          <p
            className={`rounded-full px-4 py-1.5 text-[15px] font-bold text-white [text-shadow:0_1px_6px_rgba(0,0,0,0.7)] ${
              found ? "bg-detect/30 backdrop-blur-sm" : ""
            }`}
          >
            {found ? "猫を見つけた！ シャッターを押して" : "猫に向けてください"}
          </p>
        )}
        {cam === "ready" && ai === "loading" && (
          <p className="text-xs text-white/70 [text-shadow:0_1px_4px_rgba(0,0,0,0.7)]">AIを準備中…</p>
        )}
        {cam === "ready" && ai === "failed" && (
          <p className="text-xs text-finder [text-shadow:0_1px_4px_rgba(0,0,0,0.7)]">
            検出AIを読み込めませんでした。撮影はできます
          </p>
        )}
      </div>

      {/* 起動中 / エラー表示 */}
      {cam === "starting" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-stone-400">カメラを起動中…</p>
        </div>
      )}
      {cam === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-8 text-center">
          <p className="max-w-xs text-[15px] leading-relaxed text-stone-200">{camError}</p>
          <button
            type="button"
            onClick={() => {
              setCam("starting");
              setRetry((n) => n + 1);
            }}
            className="h-12 rounded-full bg-finder px-8 text-[15px] font-bold text-black"
          >
            もう一度試す
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="h-12 rounded-full border border-white/30 px-8 text-[15px] font-semibold text-white"
          >
            写真から選ぶ
          </button>
        </div>
      )}

      {/* 下部の操作：写真から選ぶ / シャッター / 最新サムネ */}
      <div
        className="absolute inset-x-0 flex items-center justify-between px-8"
        style={{ bottom: "calc(var(--tabbar-h) + 20px)" }}
      >
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex h-14 w-16 flex-col items-center justify-center gap-0.5 rounded-2xl bg-black/40 text-[10px] font-medium text-white backdrop-blur-sm active:scale-95"
        >
          <ImageIcon width={22} height={22} />
          写真から選ぶ
        </button>

        <button
          type="button"
          onClick={shoot}
          disabled={cam !== "ready"}
          aria-label="シャッター"
          className="grid h-[78px] w-[78px] place-items-center rounded-full border-[5px] border-white bg-transparent transition-transform active:scale-90 disabled:opacity-40"
        >
          <span
            className={`block h-[58px] w-[58px] rounded-full transition-colors ${
              found ? "bg-detect shadow-[0_0_20px_var(--detect)]" : "bg-white"
            }`}
          />
        </button>

        <Link
          href="/collection"
          aria-label="コレクションを見る"
          className="h-14 w-16 overflow-hidden rounded-2xl border-2 border-white/70 bg-black/30 active:scale-95"
          style={latest ? ginghamStyle(latest.background_style, 10) : undefined}
        >
          {latestUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={latestUrl} alt="最新の猫" className="h-full w-full object-contain p-1" />
          )}
        </Link>
      </div>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickFile} />

      {capture && <CaptureSheet blob={capture.blob} located={capture.located} onClose={closeSheet} />}
    </div>
  );
}
