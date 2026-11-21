"use client";
// 撮影後のシート：切り抜き処理の進捗 → カードのプレビュー → 名前を付けて保存

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { syncCatIfLoggedIn } from "@/lib/cloud";
import { addCat, countCats } from "@/lib/db";
import type { Located } from "@/lib/geo";
import { isCloudEnabled } from "@/lib/supabase";
import { nextPatternId, randomPatternId, type PatternId } from "@/lib/patterns";
import { processPhoto, type PipelineProgress } from "@/lib/pipeline";
import CatCard from "../CatCard";

type Phase = "processing" | "no-cat" | "done" | "error";

const STAGE_TEXT: Record<PipelineProgress["stage"], string> = {
  detect: "猫を探しています…",
  download: "AIモデルを準備中（初回のみ数十秒）",
  cutout: "切り抜き中…",
  finish: "仕上げ中…",
};

// 段階ごとに進捗バーの範囲を割り当てる
function barPercent(p: PipelineProgress): number {
  switch (p.stage) {
    case "detect":
      return 5;
    case "download":
      return 5 + p.percent * 0.5;
    case "cutout":
      return 55 + p.percent * 0.35;
    default:
      return 95;
  }
}

export default function CaptureSheet({
  blob,
  located,
  onClose,
}: {
  blob: Blob;
  located: Promise<Located>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("processing");
  const [progress, setProgress] = useState<PipelineProgress>({ stage: "detect", percent: 0 });
  const [sticker, setSticker] = useState<Blob | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [patternId, setPatternId] = useState<PatternId>(randomPatternId);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const runId = useRef(0);

  const photoUrl = useObjectUrl(blob);
  const stickerUrl = useObjectUrl(sticker);

  // 切り抜き処理を実行する（force=true なら猫が見つからなくても全体を切り抜く）
  const run = useCallback(
    async (force: boolean) => {
      const id = ++runId.current;
      setPhase("processing");
      setProgress({ stage: "detect", percent: 0 });
      try {
        const res = await processPhoto(blob, (p) => id === runId.current && setProgress(p), force);
        if (id !== runId.current) return;
        if (res.status === "no-cat") {
          setPhase("no-cat");
        } else {
          setSticker(res.sticker);
          setPhase("done");
        }
      } catch (e) {
        if (id !== runId.current) return;
        console.error(e);
        setErrorMsg(
          "切り抜きに失敗しました。通信状況を確認して、もう一度お試しください（初回はAIモデルのダウンロードが必要です）。",
        );
        setPhase("error");
      }
    },
    [blob],
  );

  useEffect(() => {
    // 初回は自動で処理を開始。シートが閉じたら古い処理の結果は捨てる
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(false);
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      runId.current++;
    };
  }, [run]);

  const save = async () => {
    if (!sticker || saving) return;
    setSaving(true);
    try {
      const loc = await located; // 位置情報・地名の取得が終わるのを待つ
      const count = await countCats();
      const id = crypto.randomUUID();
      await addCat({
        id,
        name: name.trim().slice(0, 30) || `名無しの猫 #${count + 1}`,
        sticker,
        background_style: patternId,
        lat: loc.pos?.lat ?? null,
        lng: loc.pos?.lng ?? null,
        place_name: loc.place.place_name,
        country_code: loc.place.country_code,
        caught_at: new Date().toISOString(),
      });
      // ログイン中ならクラウドにも自動で保存（待たない。失敗しても端末内には残り、マイページから再送できる）
      if (isCloudEnabled) void syncCatIfLoggedIn(id);
      onClose();
      router.push(`/cat/${id}`);
    } catch (e) {
      console.error(e);
      setErrorMsg("保存に失敗しました。もう一度お試しください。");
      setPhase("error");
      setSaving(false);
    }
  };

  const pct = Math.round(barPercent(progress));

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-black" style={{ height: "100dvh" }}>
      {/* 撮った写真をぼかして背景に */}
      {photoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt=""
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl"
        />
      )}
      <div className="absolute inset-0 bg-black/40" />

      <div
        className="sheet-up relative flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-6 pt-[calc(env(safe-area-inset-top)+16px)]"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}
      >
        {phase === "processing" && (
          <div className="flex w-full max-w-xs flex-col items-center gap-4 text-center">
            <div className="h-16 w-16 spin rounded-full border-4 border-white/20 border-t-finder" />
            <p className="text-lg font-bold text-white">{STAGE_TEXT[progress.stage]}</p>
            {progress.stage === "download" && (
              <p className="text-sm text-white/70">AIモデルをダウンロード中 {progress.percent}%</p>
            )}
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-finder transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {phase === "no-cat" && (
          <div className="flex w-full max-w-xs flex-col items-center gap-4 text-center">
            <p className="text-lg font-bold text-white">猫が写っていないようです</p>
            <p className="text-sm text-white/70">猫がもう少し大きく写るように撮り直すと、きれいに切り抜けます。</p>
            <button
              type="button"
              onClick={onClose}
              className="h-12 w-full rounded-full bg-finder text-[15px] font-bold text-black"
            >
              撮り直す
            </button>
            <button
              type="button"
              onClick={() => void run(true)}
              className="h-12 w-full rounded-full border border-white/40 text-[15px] font-semibold text-white"
            >
              このまま切り抜く
            </button>
          </div>
        )}

        {phase === "error" && (
          <div className="flex w-full max-w-xs flex-col items-center gap-4 text-center">
            <p className="text-sm leading-relaxed text-white">{errorMsg}</p>
            {sticker ? (
              <button
                type="button"
                onClick={() => setPhase("done")}
                className="h-12 w-full rounded-full bg-finder text-[15px] font-bold text-black"
              >
                戻る
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void run(false)}
                className="h-12 w-full rounded-full bg-finder text-[15px] font-bold text-black"
              >
                もう一度やる
              </button>
            )}
            <button type="button" onClick={onClose} className="h-12 w-full text-[15px] text-white/80">
              撮り直す
            </button>
          </div>
        )}

        {phase === "done" && (
          <>
            <div className="w-full max-w-[min(300px,calc((100dvh-260px)*0.75))]">
              <CatCard
                mode="own"
                name={name.trim() || "名前をつけよう"}
                stickerUrl={stickerUrl}
                patternId={patternId}
                caughtAt={new Date().toISOString()}
                placeName="場所は保存時に記録"
                onPatternChange={() => setPatternId((p) => nextPatternId(p))}
                pop
              />
            </div>
            <div className="flex w-full max-w-[300px] flex-col gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
                placeholder="名前をつける（空でもOK）"
                className="h-12 rounded-2xl bg-white px-4 text-[16px] text-stone-900 outline-none placeholder:text-stone-400 focus:ring-2 focus:ring-finder"
              />
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="h-12 rounded-full bg-finder text-[15px] font-bold text-black disabled:opacity-60"
              >
                {saving ? "保存中…" : "コレクションに追加"}
              </button>
              <button type="button" onClick={onClose} className="h-11 text-[14px] text-white/80">
                撮り直す
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
