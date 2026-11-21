"use client";
// 猫カード：上はギンガムチェック＋白フチのステッカー、下は白い情報パネル
// mode="own"（自分の猫）/ "other"（他の人の猫）。他人の猫は「コレクトする」ボタンが出る

import { ClockIcon, PinIcon, UsersIcon } from "./icons";
import { ginghamStyle } from "@/lib/patterns";
import { relativeTime } from "@/lib/time";

export type CatCardProps = {
  mode: "own" | "other";
  name: string;
  stickerUrl: string | null; // Blob から作った URL か、クラウドの画像 URL
  patternId: string;
  caughtAt: string;
  placeName: string;
  ownerName?: string; // 「〇〇がキャッチ」の〇〇。own のときは省略で「あなた」
  collectCount?: number; // 「他N人が集めた」。undefined なら非表示
  onCollect?: () => void; // other のときの「コレクトする」
  collectLabel?: string;
  collectDone?: boolean; // コレクト済み（押せないグレーのボタンにする）
  onShare?: () => void; // 指定されたときだけ「シェア」を表示
  onPatternChange?: () => void; // 柄エリアをタップしたとき
  pop?: boolean; // 登場時に「ぽんっ」と出す
};

export default function CatCard({
  mode,
  name,
  stickerUrl,
  patternId,
  caughtAt,
  placeName,
  ownerName,
  collectCount,
  onCollect,
  collectLabel = "コレクトする",
  collectDone = false,
  onShare,
  onPatternChange,
  pop = false,
}: CatCardProps) {
  const owner = ownerName ?? (mode === "own" ? "あなた" : "だれか");

  return (
    <div className="mx-auto flex aspect-[3/4] w-full flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_10px_30px_rgba(0,0,0,0.35),0_0_0_1px_rgba(0,0,0,0.04)]">
      {/* 上70%：チェック柄エリア */}
      <div
        className="relative flex-[7] overflow-hidden"
        style={ginghamStyle(patternId, 22)}
        onClick={onPatternChange}
        role={onPatternChange ? "button" : undefined}
        aria-label={onPatternChange ? "背景の柄を変える" : undefined}
      >
        {stickerUrl && (
          <div className="absolute inset-0 flex items-center justify-center p-[6%]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={stickerUrl}
              alt={name}
              draggable={false}
              className={`max-h-[82%] max-w-[82%] object-contain ${pop ? "sticker-pop" : ""}`}
              style={pop ? undefined : { transform: "rotate(-4deg)" }}
            />
          </div>
        )}
        {onPatternChange && (
          <span className="absolute right-3 top-3 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-stone-600 shadow">
            タップで柄チェンジ
          </span>
        )}
      </div>

      {/* 下30%：白い情報パネル */}
      <div className="flex flex-[3] flex-col justify-between gap-1 bg-white px-4 py-3 text-stone-800">
        <div className="min-w-0">
          <p className="truncate text-[19px] font-extrabold leading-tight">{name}</p>
          <p className="truncate text-xs text-stone-500">{owner}がキャッチ</p>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-stone-500">
          <span className="inline-flex items-center gap-1">
            <ClockIcon width={13} height={13} />
            {relativeTime(caughtAt)}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <PinIcon width={13} height={13} />
            <span className="truncate">{placeName}</span>
          </span>
          {collectCount !== undefined && (
            <span className="inline-flex items-center gap-1">
              <UsersIcon width={13} height={13} />他{collectCount}人が集めた
            </span>
          )}
        </div>

        {mode === "other" && onCollect && (
          <button
            type="button"
            onClick={onCollect}
            disabled={collectDone}
            className={`mt-1 h-11 rounded-full text-sm font-bold active:scale-[0.98] ${
              collectDone ? "bg-stone-200 text-stone-500" : "bg-orange-500 text-white"
            }`}
          >
            {collectLabel}
          </button>
        )}
        {mode === "own" && onShare && (
          <button
            type="button"
            onClick={onShare}
            className="mt-1 h-11 rounded-full bg-stone-900 text-sm font-bold text-white active:scale-[0.98]"
          >
            シェア
          </button>
        )}
      </div>
    </div>
  );
}
