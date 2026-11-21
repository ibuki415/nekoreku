"use client";
// コレクション一覧用の小さいカード（チェック柄＋ステッカー＋名前＋相対時刻）

import Link from "next/link";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import type { CatRecord } from "@/lib/db";
import { ginghamStyle } from "@/lib/patterns";
import { relativeTime } from "@/lib/time";

// 端末内の猫（Blob の画像）
export default function MiniCard({ cat }: { cat: CatRecord }) {
  const url = useObjectUrl(cat.sticker);
  return <MiniCardView href={`/cat/${cat.id}`} cat={cat} url={url} />;
}

type ViewCat = { name: string; background_style: string; caught_at: string };

// 見た目だけの部品。クラウドの猫（画像URL）でも使い回す
export function MiniCardView({ href, cat, url }: { href: string; cat: ViewCat; url: string | null }) {
  return (
    <Link
      href={href}
      className="block overflow-hidden rounded-[22px] bg-white shadow-[0_6px_18px_rgba(0,0,0,0.35)] transition-transform active:scale-[0.97]"
    >
      <div className="relative aspect-square" style={ginghamStyle(cat.background_style, 16)}>
        {url && (
          <div className="absolute inset-0 flex items-center justify-center p-[8%]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={cat.name}
              draggable={false}
              className="max-h-full max-w-full object-contain"
              style={{ transform: "rotate(-4deg)" }}
            />
          </div>
        )}
      </div>
      <div className="px-3 py-2 text-stone-800">
        <p className="truncate text-sm font-extrabold">{cat.name}</p>
        <p className="truncate text-[11px] text-stone-500">{relativeTime(cat.caught_at)}</p>
      </div>
    </Link>
  );
}
