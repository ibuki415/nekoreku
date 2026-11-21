"use client";
// 地図（MapLibre + OpenFreeMap）。猫のステッカーをピンにして表示する。
// maplibre-gl の JS は useEffect の中で動的 import（サーバーでは動かさない・初期JSを軽くする）

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  fetchCatsInBounds,
  fetchCountryCounts,
  fetchMyCollectedIds,
  publicImageUrl,
  type CountryCount,
} from "@/lib/cloud";
import { flagEmoji } from "@/lib/flag";
import { getPosition } from "@/lib/geo";
import { ginghamStyle } from "@/lib/patterns";
import { isCloudEnabled } from "@/lib/supabase";
import { relativeTime } from "@/lib/time";

// ピンの状態：自分が撮った / コレクトした / まだ集めていない（後者2つは今後のソーシャル機能用）
export type PinStatus = "caught" | "collected" | "new";

export type MapCat = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  stickerUrl: string;
  patternId: string;
  caughtAt: string;
  placeName: string;
  status: PinStatus;
  href: string; // 「カードを見る」の行き先
  countryCode: string | null; // 国ごとの数字バブル用（端末内の猫を集計するとき）
};

// 国ごとの数字バブル
type Bubble = { cc: string; count: number; lat: number; lng: number };

const STATUS_COLOR: Record<PinStatus, string> = {
  caught: "#2f7cf6",
  collected: "#ff8a1f",
  new: "#111111",
};
const STATUS_LABEL: Record<PinStatus, string> = {
  caught: "Caught",
  collected: "Collected",
  new: "New to you",
};
// クラウド有効のときは3色すべて、端末内モードでは自分の猫（Caught）だけ
const LEGEND: PinStatus[] = isCloudEnabled ? ["caught", "collected", "new"] : ["caught"];
const BUBBLE_ZOOM = 5; // これより引いたらピンを隠して国バブルにする

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const TOKYO_STATION: [number, number] = [139.767, 35.681]; // [経度, 緯度]

type Props = {
  cats: MapCat[]; // 端末内の猫
  focusId?: string | null;
  focusPos?: { lat: number; lng: number } | null; // 端末内に無い猫（クラウドの猫）へ寄るときの座標
  userId: string | null; // ログイン中ならクラウドの猫も取得する
};

// ピンの見た目（HTML要素）を作る
function createPinElement(cat: MapCat) {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", cat.name);
  el.style.cssText = `width:54px;height:54px;border-radius:9999px;padding:0;cursor:pointer;
    border:4px solid ${STATUS_COLOR[cat.status]};background:#fff;overflow:hidden;
    box-shadow:0 3px 10px rgba(0,0,0,.35);transition:transform .15s;`;
  const img = document.createElement("img");
  img.src = cat.stickerUrl;
  img.alt = "";
  img.draggable = false;
  img.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;";
  el.appendChild(img);
  return el;
}

// 国バブルの見た目（国旗＋件数）
function createBubbleElement(b: Bubble) {
  const el = document.createElement("button");
  el.type = "button";
  const flag = flagEmoji(b.cc) || b.cc;
  el.setAttribute("aria-label", `${b.cc} ${b.count}匹`);
  el.style.cssText = `display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:9999px;
    border:3px solid #ffd400;background:#111;color:#fff;font-size:16px;font-weight:800;cursor:pointer;
    box-shadow:0 3px 10px rgba(0,0,0,.4);`;
  el.textContent = `${flag} ${b.count}`;
  return el;
}

export default function CatMap({ cats: localCats, focusId, focusPos, userId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markersRef = useRef<Map<string, { marker: Marker; el: HTMLElement; sig: string }>>(new Map());
  const bubbleMarkersRef = useRef<Marker[]>([]);
  const scheduleRef = useRef<() => void>(() => {}); // クラウド取得の予約（デバウンス付き。下の effect が差し替える）
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lowZoom, setLowZoom] = useState(false); // zoom < 5 のとき true（ピンを隠してバブル表示）
  const [cloudCats, setCloudCats] = useState<MapCat[]>([]);
  const [cloudCounts, setCloudCounts] = useState<CountryCount[] | null>(null);
  const [cloudError, setCloudError] = useState(false);

  // 初期表示の計算に使う値は「最初の1回だけ」読めればよいので ref に退避
  const initial = useRef({ cats: localCats, focusId, focusPos });
  const lastFocus = useRef(focusId); // 最後に飛んだ focus（クラウド取得で猫が増えても勝手に戻さないため）

  // 端末内の猫 + クラウドの猫（同じ id は端末内を優先。正確な位置・Blob 画像があるため）
  const cats = useMemo(() => {
    const byId = new Map<string, MapCat>();
    if (userId) cloudCats.forEach((c) => byId.set(c.id, c));
    localCats.forEach((c) => byId.set(c.id, c));
    return [...byId.values()];
  }, [localCats, cloudCats, userId]);

  // 国バブル：クラウドの集計があればそれ、なければ端末内の猫から集計
  const bubbles = useMemo<Bubble[]>(() => {
    if (userId && cloudCounts) {
      return cloudCounts.map((r) => ({ cc: r.country_code, count: r.cat_count, lat: r.lat, lng: r.lng }));
    }
    const agg = new Map<string, { count: number; lat: number; lng: number }>();
    for (const c of localCats) {
      if (!c.countryCode) continue;
      const a = agg.get(c.countryCode) ?? { count: 0, lat: 0, lng: 0 };
      a.count++;
      a.lat += c.lat;
      a.lng += c.lng;
      agg.set(c.countryCode, a);
    }
    return [...agg.entries()].map(([cc, a]) => ({ cc, count: a.count, lat: a.lat / a.count, lng: a.lng / a.count }));
  }, [localCats, cloudCounts, userId]);

  // ---- 地図の作成（1回だけ） ----
  useEffect(() => {
    let cancelled = false;
    let map: MLMap | null = null;
    const markers = markersRef.current;
    const bubbleMarkers = bubbleMarkersRef.current;
    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;
      // Worker は public/maplibre に置いたものを使う（scripts/copy-assets.mjs がコピー）
      ml.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      mlRef.current = ml;

      const { cats: c0, focusId: f0, focusPos: fp } = initial.current;
      const focus = (f0 ? c0.find((c) => c.id === f0) : undefined) ?? fp ?? undefined;

      // 初期位置：focus があればその猫へ zoom16 / 猫がいれば全部入るように / いなければ東京駅
      const opts: ConstructorParameters<typeof ml.Map>[0] = {
        container: containerRef.current,
        style: STYLE_URL,
        pitch: 50,
        center: focus ? [focus.lng, focus.lat] : TOKYO_STATION,
        zoom: focus ? 16 : 14,
        maxPitch: 70,
      };
      if (!focus && c0.length > 0) {
        const b = new ml.LngLatBounds();
        c0.forEach((c) => b.extend([c.lng, c.lat]));
        opts.bounds = b;
        opts.fitBoundsOptions = { padding: 60, maxZoom: 16 };
      }
      map = new ml.Map(opts);
      mapRef.current = map;

      // 現在地ボタン（右上）
      map.addControl(
        new ml.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }),
        "top-right",
      );

      map.on("error", () => {
        // スタイル自体が読めないときだけエラー表示（タイル1枚の失敗は無視）
        if (map && !map.isStyleLoaded() && !map.loaded()) setMapError(true);
      });

      map.on("load", () => {
        if (!map) return;
        const style = map.getStyle();

        // ラベルを日本語優先に（name:ja が無ければ name）。道路の番号表示(shield)は壊さない
        for (const layer of style.layers) {
          if (layer.type !== "symbol" || layer.id.includes("shield")) continue;
          const tf = layer.layout?.["text-field"];
          if (tf !== undefined && JSON.stringify(tf).includes("name")) {
            map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name:ja"], ["get", "name"]]);
          }
        }

        // 3D建物：スタイルに無いときだけ自前で追加（liberty には building-3d がある）
        if (!map.getLayer("building-3d") && map.getSource("openmaptiles")) {
          const firstSymbol = style.layers.find((l) => l.type === "symbol")?.id;
          map.addLayer(
            {
              id: "building-3d",
              type: "fill-extrusion",
              source: "openmaptiles",
              "source-layer": "building",
              minzoom: 14,
              paint: {
                "fill-extrusion-color": "#d9d4cc",
                "fill-extrusion-height": ["get", "render_height"],
                "fill-extrusion-base": ["get", "render_min_height"],
                "fill-extrusion-opacity": 0.8,
              },
            },
            firstSymbol,
          );
        }
        setLowZoom(map.getZoom() < BUBBLE_ZOOM);
        setReady(true);
      });

      // ズームの変化でピン⇔国バブルを切り替える／動きが止まったらクラウドの猫を取り直す
      map.on("zoom", () => map && setLowZoom(map.getZoom() < BUBBLE_ZOOM));
      map.on("moveend", () => scheduleRef.current());

      map.on("click", () => setSelectedId(null)); // 地図の空いたところをタップで閉じる

      // 猫ゼロなら現在地へ（取れなければ東京駅のまま）
      if (c0.length === 0) {
        const pos = await getPosition();
        if (pos && !cancelled && map) map.jumpTo({ center: [pos.lng, pos.lat], zoom: 14 });
      }
    })();

    return () => {
      cancelled = true;
      markers.forEach(({ marker }) => marker.remove());
      markers.clear();
      bubbleMarkers.forEach((m) => m.remove());
      bubbleMarkers.length = 0;
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // ---- クラウドの猫を取得（表示範囲が変わるたび。200ms デバウンス・最大300匹）----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !isCloudEnabled || !userId) {
      scheduleRef.current = () => {};
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let seq = 0; // 古い応答が新しい結果を上書きしないための通し番号

    const run = async () => {
      const mySeq = ++seq;
      try {
        if (map.getZoom() < BUBBLE_ZOOM) {
          // 引いているときは国ごとの件数だけ
          const counts = await fetchCountryCounts();
          if (alive && mySeq === seq) {
            setCloudCounts(counts);
            setCloudError(false);
          }
          return;
        }
        const b = map.getBounds();
        const [rows, collected] = await Promise.all([
          fetchCatsInBounds({ south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() }),
          fetchMyCollectedIds(userId),
        ]);
        if (!alive || mySeq !== seq) return;
        setCloudCats(
          rows
            .filter((r) => r.lat !== null && r.lng !== null)
            .map<MapCat>((r) => ({
              id: r.id,
              name: r.name,
              lat: r.lat as number,
              lng: r.lng as number,
              stickerUrl: publicImageUrl(r.image_path),
              patternId: r.background_style,
              caughtAt: r.caught_at,
              placeName: r.place_name,
              // 自分の猫=Caught / コレクト済み=Collected / それ以外=New to you
              status: r.owner_id === userId ? "caught" : collected.has(r.id) ? "collected" : "new",
              href: `/cat/${r.id}?src=cloud`,
              countryCode: r.country_code,
            })),
        );
        setCloudError(false);
      } catch (e) {
        console.error("みんなの猫の取得に失敗", e);
        if (alive && mySeq === seq) setCloudError(true);
      }
    };

    scheduleRef.current = () => {
      clearTimeout(timer);
      timer = setTimeout(run, 200);
    };
    scheduleRef.current(); // 最初の1回
    return () => {
      alive = false;
      clearTimeout(timer);
      scheduleRef.current = () => {};
    };
  }, [ready, userId]);

  // ---- ピンの更新（差分だけ追加・削除。zoom < 5 のときは全部隠す）----
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!ready || !map || !ml) return;
    const markers = markersRef.current;
    const want = lowZoom ? [] : cats;
    const sigOf = (c: MapCat) => `${c.status}|${c.stickerUrl}`;
    const wantSig = new Map(want.map((c) => [c.id, sigOf(c)]));
    markers.forEach((v, id) => {
      if (wantSig.get(id) !== v.sig) {
        v.marker.remove();
        markers.delete(id);
      }
    });
    for (const cat of want) {
      if (markers.has(cat.id)) continue;
      const el = createPinElement(cat);
      el.addEventListener("click", (e) => {
        e.stopPropagation(); // 地図側のクリック（選択解除）に伝えない
        setSelectedId(cat.id);
      });
      const marker = new ml.Marker({ element: el, anchor: "center" }).setLngLat([cat.lng, cat.lat]).addTo(map);
      markers.set(cat.id, { marker, el, sig: sigOf(cat) });
    }
  }, [cats, lowZoom, ready]);

  // ---- 国バブル（zoom < 5 のときだけ。タップで zoom 6 へ）----
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    const list = bubbleMarkersRef.current;
    list.forEach((m) => m.remove());
    list.length = 0;
    if (!ready || !map || !ml || !lowZoom) return;
    for (const b of bubbles) {
      const el = createBubbleElement(b);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        map.flyTo({ center: [b.lng, b.lat], zoom: 6 });
      });
      list.push(new ml.Marker({ element: el, anchor: "center" }).setLngLat([b.lng, b.lat]).addTo(map));
    }
  }, [bubbles, lowZoom, ready]);

  // ---- 選択中のピンを少し大きく ----
  useEffect(() => {
    markersRef.current.forEach(({ el }, id) => {
      el.style.transform = id === selectedId ? "scale(1.25)" : "scale(1)";
      el.style.zIndex = id === selectedId ? "2" : "1";
    });
  }, [selectedId, cats, ready, lowZoom]);

  // ---- focus が後から変わったらそこへ移動（猫の一覧が増えただけでは動かさない）----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focusId || lastFocus.current === focusId) return;
    const cat = cats.find((c) => c.id === focusId);
    if (cat) {
      lastFocus.current = focusId;
      map.flyTo({ center: [cat.lng, cat.lat], zoom: 16 });
    }
  }, [focusId, cats, ready]);

  const selected = lowZoom ? null : (cats.find((c) => c.id === selectedId) ?? null);

  return (
    <div className="absolute inset-x-0 top-0" style={{ bottom: "var(--tabbar-h)" }}>
      <div ref={containerRef} className="h-full w-full" />

      {!ready && !mapError && (
        <div className="absolute inset-0 grid place-items-center bg-[#0b0b0c]">
          <p className="text-sm text-stone-400">地図を準備中…</p>
        </div>
      )}
      {mapError && (
        <div className="absolute inset-0 grid place-items-center bg-[#0b0b0c] px-8 text-center">
          <p className="text-sm leading-relaxed text-stone-300">
            地図を読み込めませんでした。通信状況を確認してください。
          </p>
        </div>
      )}

      {/* クラウド有効：未ログインの案内 / 取得失敗の通知（上部） */}
      {isCloudEnabled && !userId && (
        <Link
          href="/account"
          className="absolute left-3 top-[calc(env(safe-area-inset-top)+12px)] z-10 rounded-full bg-black/70 px-4 py-2 text-xs font-semibold text-white backdrop-blur-sm"
        >
          ログインすると、みんなの猫が見えます
        </Link>
      )}
      {cloudError && (
        <p className="absolute left-3 top-[calc(env(safe-area-inset-top)+12px)] z-10 rounded-full bg-red-900/80 px-4 py-2 text-xs font-semibold text-white">
          みんなの猫を読み込めませんでした
        </p>
      )}

      {/* 凡例（左下）。ピンを選んだときはミニカードを避けて上にずらす */}
      <ul
        className="absolute left-3 z-10 flex flex-col gap-1 rounded-2xl bg-black/65 px-3 py-2 text-[11px] font-medium text-white backdrop-blur-sm transition-[bottom]"
        style={{ bottom: selected ? 138 : 28 }}
      >
        {LEGEND.map((s) => (
          <li key={s} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full border-2 border-white" style={{ background: STATUS_COLOR[s] }} />
            {STATUS_LABEL[s]}
          </li>
        ))}
      </ul>

      {/* ピンをタップしたときのミニカード */}
      {selected && (
        <div className="sheet-up absolute inset-x-3 bottom-3 z-20 flex items-center gap-3 rounded-3xl bg-white p-3 text-stone-800 shadow-[0_8px_28px_rgba(0,0,0,0.4)]">
          <div className="relative h-[84px] w-[84px] shrink-0 overflow-hidden rounded-2xl" style={ginghamStyle(selected.patternId, 14)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={selected.stickerUrl} alt="" className="h-full w-full object-contain p-1.5" style={{ transform: "rotate(-4deg)" }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-extrabold">{selected.name}</p>
            <p className="truncate text-xs text-stone-500">
              {relativeTime(selected.caughtAt)} ・ {selected.placeName}
            </p>
            <Link
              href={selected.href}
              className="mt-2 inline-grid h-10 place-items-center rounded-full bg-stone-900 px-5 text-[13px] font-bold text-white"
            >
              カードを見る
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
