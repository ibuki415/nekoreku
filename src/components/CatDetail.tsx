"use client";
// カード詳細：大きなカード表示 + 名前の変更 + 削除 + 地図で見る

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { currentUserId, fetchCloudCat, fetchProfile, syncDelete, syncRename } from "@/lib/cloud";
import { deleteCat, getCat, updateCat, type CatRecord } from "@/lib/db";
import { shareCardImage } from "@/lib/renderCard";
import { isCloudEnabled } from "@/lib/supabase";
import CatCard from "./CatCard";
import { EditIcon, MapIcon, TrashIcon } from "./icons";

export default function CatDetail({ id }: { id: string }) {
  const router = useRouter();
  const [cat, setCat] = useState<CatRecord | null | undefined>(undefined); // undefined=読み込み中, null=なし
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [collectCount, setCollectCount] = useState<number | undefined>(undefined);
  const [shareMsg, setShareMsg] = useState("");
  const stickerUrl = useObjectUrl(cat?.sticker);

  useEffect(() => {
    let alive = true;
    getCat(id)
      .then((c) => alive && setCat(c ?? null))
      .catch(() => alive && setCat(null));
    return () => {
      alive = false;
    };
  }, [id]);

  // 同期済みの猫なら、クラウド側の「他N人が集めた」を取ってくる（失敗しても表示しないだけ）
  const remoteId = cat?.remote_id;
  useEffect(() => {
    if (!isCloudEnabled || !remoteId) return;
    let alive = true;
    fetchCloudCat(remoteId)
      .then((row) => alive && row && setCollectCount(row.collect_count))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [remoteId]);

  // シェア画像を作って共有（共有できない環境ではダウンロード）
  const share = async () => {
    if (!cat || busy) return;
    setBusy(true);
    setShareMsg("画像を作っています…");
    try {
      // ログイン中なら表示名を載せる。それ以外は「わたし」
      let ownerName = "わたし";
      const uid = await currentUserId();
      if (uid) ownerName = (await fetchProfile(uid).catch(() => null))?.display_name || ownerName;
      const r = await shareCardImage({
        name: cat.name,
        sticker: cat.sticker,
        patternId: cat.background_style,
        caughtAt: cat.caught_at,
        placeName: cat.place_name,
        ownerName,
        collectCount,
      });
      setShareMsg(r === "downloaded" ? "画像を保存しました。" : "");
    } catch {
      setShareMsg("シェア画像を作れませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    if (!cat) return;
    const name = draft.trim().slice(0, 30);
    if (!name) {
      setError("名前は1文字以上入れてください");
      return;
    }
    setBusy(true);
    try {
      const next = await updateCat(cat.id, { name });
      if (next) {
        setCat(next);
        void syncRename(next); // クラウドにも反映（失敗しても端末内は保存済み）
      }
      setEditing(false);
      setError("");
    } catch {
      setError("名前を保存できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!cat) return;
    setBusy(true);
    try {
      await syncDelete(cat); // クラウド側も消す（失敗しても続行）
      await deleteCat(cat.id);
      router.replace("/collection");
    } catch {
      setError("削除できませんでした");
      setConfirming(false);
      setBusy(false);
    }
  };

  const wrap = "flex flex-1 flex-col px-5 pt-[calc(env(safe-area-inset-top)+20px)] pb-[calc(var(--tabbar-h)+28px)]";

  if (cat === undefined) return <p className="p-10 text-center text-sm text-stone-500">読み込み中…</p>;

  if (cat === null) {
    return (
      <main className={`${wrap} items-center justify-center gap-5 text-center`}>
        <p className="text-[15px] text-stone-300">見つかりませんでした</p>
        <Link href="/collection" className="grid h-12 place-items-center rounded-full bg-finder px-8 text-[15px] font-bold text-black">
          コレクションへ戻る
        </Link>
      </main>
    );
  }

  return (
    <main className={`${wrap} items-center gap-5`}>
      <div className="w-full max-w-[340px]">
        <CatCard
          mode="own"
          name={cat.name}
          stickerUrl={stickerUrl}
          patternId={cat.background_style}
          caughtAt={cat.caught_at}
          placeName={cat.place_name}
          collectCount={collectCount}
          onShare={share}
        />
        {shareMsg && <p className="mt-2 text-center text-xs text-stone-400">{shareMsg}</p>}
      </div>

      <div className="flex w-full max-w-[340px] flex-col gap-3">
        {editing ? (
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={30}
              autoFocus
              aria-label="猫の名前"
              className="h-12 min-w-0 flex-1 rounded-2xl bg-white px-4 text-[16px] text-stone-900 outline-none focus:ring-2 focus:ring-finder"
            />
            <button
              type="button"
              onClick={saveName}
              disabled={busy}
              className="h-12 rounded-2xl bg-finder px-5 text-sm font-bold text-black disabled:opacity-60"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError("");
              }}
              className="h-12 px-2 text-sm text-stone-400"
            >
              やめる
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(cat.name);
              setEditing(true);
            }}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/10 text-[15px] font-semibold"
          >
            <EditIcon width={18} height={18} />
            名前を変える
          </button>
        )}
        {error && <p className="text-center text-xs text-red-400">{error}</p>}

        {cat.lat !== null && cat.lng !== null && (
          <Link
            href={`/map?focus=${cat.id}`}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/10 text-[15px] font-semibold"
          >
            <MapIcon width={18} height={18} />
            地図で見る
          </Link>
        )}

        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold text-red-400"
        >
          <TrashIcon width={18} height={18} />
          削除
        </button>
      </div>

      {/* 削除の確認ダイアログ */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-5 sm:items-center">
          <div role="alertdialog" aria-modal="true" className="sheet-up w-full max-w-sm rounded-3xl bg-[#1c1c1f] p-6 text-center">
            <p className="text-[16px] font-bold leading-relaxed">この猫をコレクションから削除しますか？</p>
            <p className="mt-1 text-sm text-stone-400">元に戻せません</p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="h-12 rounded-full bg-red-500 text-[15px] font-bold text-white disabled:opacity-60"
              >
                {busy ? "削除中…" : "削除する"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="h-12 rounded-full text-[15px] text-stone-300"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
