"use client";
// 地図ページの中身：端末内の猫を読み込んで CatMap に渡す（?focus=<id> に対応）

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { listCats } from "@/lib/db";
import CatMap, { type MapCat } from "./CatMap";

export default function MapScreen() {
  const params = useSearchParams();
  const focusId = params.get("focus");
  // 他の人の猫へ「地図で見る」から来たときは座標も付いてくる
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const focusPos = params.get("lat") && params.get("lng") && isFinite(lat) && isFinite(lng) ? { lat, lng } : null;
  const { user } = useSession();
  const [cats, setCats] = useState<MapCat[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    listCats()
      .then((list) => {
        if (!alive) return;
        // 位置情報のある猫だけを地図に出す。Blob は表示用 URL にする
        const mapCats: MapCat[] = list
          .filter((c) => c.lat !== null && c.lng !== null)
          .map((c) => {
            const stickerUrl = URL.createObjectURL(c.sticker);
            urls.push(stickerUrl);
            return {
              id: c.id,
              name: c.name,
              lat: c.lat as number,
              lng: c.lng as number,
              stickerUrl,
              patternId: c.background_style,
              caughtAt: c.caught_at,
              placeName: c.place_name,
              status: "caught",
              href: `/cat/${c.id}`,
              countryCode: c.country_code,
            };
          });
        setCats(mapCats);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
      setCats(null);
    };
  }, []);

  if (error) return <p className="p-10 text-center text-sm text-stone-400">読み込めませんでした。もう一度開いてください。</p>;
  if (!cats) return <p className="p-10 text-center text-sm text-stone-500">読み込み中…</p>;
  return <CatMap cats={cats} focusId={focusId} focusPos={focusPos} userId={user?.id ?? null} />;
}
