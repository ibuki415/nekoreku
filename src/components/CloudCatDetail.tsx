"use client";
// クラウドの猫の詳細（他の人の猫も見られる）。「コレクトする」でコレクションに追加できる

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/hooks/useSession";
import {
  collectCat,
  fetchCloudCat,
  fetchMyCollectedIds,
  fetchProfile,
  publicImageUrl,
  uncollectCat,
  type CloudCatRow,
} from "@/lib/cloud";
import { isCloudEnabled } from "@/lib/supabase";
import CatCard from "./CatCard";
import { MapIcon } from "./icons";

const wrap = "flex flex-1 flex-col px-5 pt-[calc(env(safe-area-inset-top)+20px)] pb-[calc(var(--tabbar-h)+28px)]";

function Message({ text, action }: { text: string; action?: { href: string; label: string } }) {
  return (
    <main className={`${wrap} items-center justify-center gap-5 text-center`}>
      <p className="text-[15px] leading-relaxed text-stone-300">{text}</p>
      {action && (
        <Link href={action.href} className="grid h-12 place-items-center rounded-full bg-finder px-8 text-[15px] font-bold text-black">
          {action.label}
        </Link>
      )}
    </main>
  );
}

export default function CloudCatDetail({ id }: { id: string }) {
  const { user, loading } = useSession();
  const [cat, setCat] = useState<CloudCatRow | null | undefined>(undefined); // undefined=読み込み中
  const [ownerName, setOwnerName] = useState<string | undefined>(undefined);
  const [collected, setCollected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const userId = user?.id ?? null;

  useEffect(() => {
    if (!isCloudEnabled || loading || !userId) return;
    let alive = true;
    (async () => {
      try {
        const row = await fetchCloudCat(id);
        if (!alive) return;
        if (!row) {
          setCat(null);
          return;
        }
        setCat(row);
        const [prof, ids] = await Promise.all([
          fetchProfile(row.owner_id).catch(() => null),
          fetchMyCollectedIds(userId).catch(() => new Set<string>()),
        ]);
        if (!alive) return;
        setOwnerName(prof?.display_name);
        setCollected(ids.has(id));
      } catch {
        if (alive) setCat(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, loading, userId]);

  const toggle = useCallback(async () => {
    if (!userId || !cat || busy) return;
    setBusy(true);
    setError("");
    try {
      if (collected) {
        await uncollectCat(userId, cat.id);
        setCollected(false);
        setCat({ ...cat, collect_count: Math.max(0, cat.collect_count - 1) });
      } else {
        await collectCat(userId, cat.id);
        setCollected(true);
        setCat({ ...cat, collect_count: cat.collect_count + 1 });
      }
    } catch {
      setError("うまくいきませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }, [userId, cat, busy, collected]);

  if (!isCloudEnabled) return <Message text="クラウド機能は未設定です" action={{ href: "/account", label: "マイページへ" }} />;
  if (loading) return <p className="p-10 text-center text-sm text-stone-500">読み込み中…</p>;
  if (!userId) {
    return <Message text="みんなの猫を見るにはログインが必要です" action={{ href: "/account", label: "ログインする" }} />;
  }
  if (cat === undefined) return <p className="p-10 text-center text-sm text-stone-500">読み込み中…</p>;
  if (cat === null) {
    return <Message text="見つかりませんでした" action={{ href: "/collection", label: "コレクションへ戻る" }} />;
  }

  const mine = cat.owner_id === userId;

  return (
    <main className={`${wrap} items-center gap-5`}>
      <div className="w-full max-w-[340px]">
        <CatCard
          mode={mine ? "own" : "other"}
          name={cat.name}
          stickerUrl={publicImageUrl(cat.image_path)}
          patternId={cat.background_style}
          caughtAt={cat.caught_at}
          placeName={cat.place_name}
          ownerName={mine ? undefined : (ownerName ?? "だれか")}
          collectCount={cat.collect_count}
          onCollect={mine ? undefined : toggle}
          collectLabel={collected ? "コレクト済み" : busy ? "処理中…" : "コレクトする"}
          collectDone={collected}
        />
      </div>

      <div className="flex w-full max-w-[340px] flex-col gap-3">
        {error && <p className="text-center text-xs text-red-400">{error}</p>}
        {mine && (
          <Link
            href={`/cat/${cat.id}`}
            className="flex h-12 items-center justify-center rounded-2xl bg-white/10 text-[15px] font-semibold"
          >
            自分のカードを開く
          </Link>
        )}
        {!mine && collected && (
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            className="h-12 rounded-2xl text-[14px] text-stone-400 underline underline-offset-2 disabled:opacity-60"
          >
            コレクトを解除する
          </button>
        )}
        {cat.lat !== null && cat.lng !== null && (
          <Link
            href={`/map?focus=${cat.id}&lat=${cat.lat}&lng=${cat.lng}`}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/10 text-[15px] font-semibold"
          >
            <MapIcon width={18} height={18} />
            地図で見る
          </Link>
        )}
      </div>
    </main>
  );
}
