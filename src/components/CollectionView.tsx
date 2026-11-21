"use client";
// コレクション一覧：キャッチ（自分が撮った）と、コレクト（集めた）をタブで切り替える。
// クラウド未設定のときはタブなしで、いままで通り自分の猫だけを出す

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { listCollectedCats, publicImageUrl, type CloudCatRow } from "@/lib/cloud";
import { listCats, type CatRecord } from "@/lib/db";
import { isCloudEnabled } from "@/lib/supabase";
import { PawIcon } from "./icons";
import MiniCard, { MiniCardView } from "./MiniCard";

type Tab = "caught" | "collected";

export default function CollectionView() {
  const [tab, setTab] = useState<Tab>("caught");
  const [cats, setCats] = useState<CatRecord[] | null>(null);
  const [error, setError] = useState(false);

  // 画面が表示されるたびに読み直す（撮影後に戻ってきたときも最新になる）
  useEffect(() => {
    let alive = true;
    listCats()
      .then((c) => alive && setCats(c))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  const tabBtn = (t: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === t}
      onClick={() => setTab(t)}
      className={`h-11 flex-1 rounded-full text-sm font-bold transition-colors ${
        tab === t ? "bg-finder text-black" : "text-stone-400"
      }`}
    >
      {label}
    </button>
  );

  return (
    <main className="flex flex-1 flex-col px-4 pt-[calc(env(safe-area-inset-top)+20px)] pb-[calc(var(--tabbar-h)+24px)]">
      <header className="mb-4 flex items-end justify-between px-1">
        <div className="flex items-baseline gap-2">
          <h1 className="text-2xl font-extrabold">コレクション</h1>
          {cats && tab === "caught" && <span className="text-sm font-semibold text-finder">{cats.length}匹</span>}
        </div>
      </header>

      {isCloudEnabled && (
        <div role="tablist" className="mb-4 flex rounded-full bg-white/10 p-1">
          {tabBtn("caught", "キャッチ")}
          {tabBtn("collected", "コレクト")}
        </div>
      )}

      {tab === "caught" ? <CaughtList cats={cats} error={error} /> : <CollectedList />}
    </main>
  );
}

function CaughtList({ cats, error }: { cats: CatRecord[] | null; error: boolean }) {
  return (
    <>
      {error && <p className="mt-10 text-center text-sm text-stone-400">読み込めませんでした。もう一度開いてください。</p>}
      {!error && cats === null && <p className="mt-10 text-center text-sm text-stone-500">読み込み中…</p>}

      {cats && cats.length === 0 && (
        <div className="mt-16 flex flex-col items-center gap-5 text-center">
          <PawIcon width={56} height={56} className="text-stone-700" />
          <p className="text-[15px] leading-relaxed text-stone-300">
            まだ猫がいません。
            <br />
            街で猫を探しにいこう
          </p>
          <Link href="/camera" className="grid h-12 place-items-center rounded-full bg-finder px-8 text-[15px] font-bold text-black">
            撮りに行く
          </Link>
        </div>
      )}

      {cats && cats.length > 0 && (
        <ul className="grid grid-cols-2 gap-3.5">
          {cats.map((c) => (
            <li key={c.id}>
              <MiniCard cat={c} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// 他の人の猫を集めたもの（ログインが必要）
function CollectedList() {
  const { user, loading } = useSession();
  const userId = user?.id ?? null;
  const [rows, setRows] = useState<CloudCatRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    listCollectedCats(userId)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [userId]);

  if (loading) return <p className="mt-10 text-center text-sm text-stone-500">読み込み中…</p>;
  if (!userId) {
    return (
      <div className="mt-16 flex flex-col items-center gap-5 text-center">
        <PawIcon width={56} height={56} className="text-stone-700" />
        <p className="text-[15px] leading-relaxed text-stone-300">
          コレクトした猫を見るには
          <br />
          ログインが必要です
        </p>
        <Link href="/account" className="grid h-12 place-items-center rounded-full bg-finder px-8 text-[15px] font-bold text-black">
          ログインする
        </Link>
      </div>
    );
  }
  if (error) return <p className="mt-10 text-center text-sm text-stone-400">読み込めませんでした。もう一度開いてください。</p>;
  if (!rows) return <p className="mt-10 text-center text-sm text-stone-500">読み込み中…</p>;
  if (rows.length === 0) {
    return (
      <div className="mt-16 flex flex-col items-center gap-5 text-center">
        <PawIcon width={56} height={56} className="text-stone-700" />
        <p className="text-[15px] leading-relaxed text-stone-300">
          まだコレクトした猫はいません。
          <br />
          地図で、みんなの猫を探してみよう
        </p>
        <Link href="/map" className="grid h-12 place-items-center rounded-full bg-finder px-8 text-[15px] font-bold text-black">
          地図を開く
        </Link>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-3.5">
      {rows.map((c) => (
        <li key={c.id}>
          <MiniCardView href={`/cat/${c.id}?src=cloud`} cat={c} url={publicImageUrl(c.image_path)} />
        </li>
      ))}
    </ul>
  );
}
