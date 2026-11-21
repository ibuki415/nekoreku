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

// ピンの見た目（HTML要素）を作る。
// 丸い写真の下にしずく形の「とがり」を付け、その先端が撮影した地点を指す（anchor: "bottom"）。
// ※ marker の要素そのものの transform は MapLibre が位置合わせに使うので、拡大は内側(.pin-inner)で行う
function createPinElement(cat: MapCat) {
  const color = STATUS_COLOR[cat.status];
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", `${cat.name}（${cat.placeName}で撮影）`);
  el.style.cssText = "padding:0;border:0;background:none;cursor:pointer;";
  const inner = document.createElement("div");
  inner.className = "pin-inner";
  inner.style.cssText = `display:flex;flex-direction:column;align-items:center;transform-origin:50% 100%;
    transition:transform .15s;filter:drop-shadow(0 3px 5px rgba(0,0,0,.35));`;
  const circle = document.createElement("div");
  circle.style.cssText = `width:54px;height:54px;border-radius:9999px;border:4px solid ${color};
    background:#fff;overflow:hidden;box-sizing:border-box;`;
  const img = document.createElement("img");
  img.src = cat.stickerUrl;
  img.alt = "";
  img.draggable = false;
  img.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;";
  circle.appendChild(img);
  const tail = document.createElement("div");
  tail.style.cssText = `width:0;height:0;margin-top:-2px;border-left:9px solid transparent;
    border-right:9px solid transparent;border-top:13px solid ${color};`;
  inner.append(circle, tail);
  el.appendChild(inner);
  return el;
}

// 2点間の距離（メートル）。地球を球として計算（ハバーサイン公式）
function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDistance(m: number) {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)}m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`;
}

type MyPos = { lat: number; lng: number };

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
  const [me, setMe] = useState<MyPos | null>(null); // 自分の現在地（取れたら青い点で表示）
  const [geoNote, setGeoNote] = useState<string | null>(null); // 現在地が取れないときの一言
  const meMarkerRef = useRef<Marker | null>(null);

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
        // 選んだ猫と現在地を結ぶ点線（中身は後の effect で入れる）
        map.addSource("me-line", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "me-line",
          type: "line",
          source: "me-line",
          layout: { "line-cap": "round" },
          paint: { "line-color": "#1a73e8", "line-width": 3, "line-dasharray": [0.5, 2] },
        });

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
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
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
      const inner = el.querySelector<HTMLElement>(".pin-inner");
      if (inner) inner.style.transform = id === selectedId ? "scale(1.25)" : "scale(1)";
      el.style.zIndex = id === selectedId ? "2" : "1";
    });
  }, [selectedId, cats, ready, lowZoom]);

  // ---- 現在地を追いかける（歩くと青い点も動く）----
  useEffect(() => {
    if (!ready) return;
    if (!("geolocation" in navigator)) return; // 非対応端末はボタンを押したときに案内する
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setMe({ lat: p.coords.latitude, lng: p.coords.longitude });
        setGeoNote(null);
      },
      (err) => {
        setGeoNote(
          err.code === err.PERMISSION_DENIED
            ? "位置情報がオフです（設定 → Safari → 位置情報 で許可）"
            : "現在地を取得できませんでした",
        );
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [ready]);

  // ---- 現在地の青い点を置く・動かす ----
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!ready || !map || !ml || !me) return;
    if (!meMarkerRef.current) {
      const el = document.createElement("div");
      el.className = "me-dot";
      el.style.zIndex = "3";
      el.setAttribute("aria-label", "現在地");
      meMarkerRef.current = new ml.Marker({ element: el, anchor: "center" }).setLngLat([me.lng, me.lat]).addTo(map);
    } else {
      meMarkerRef.current.setLngLat([me.lng, me.lat]);
    }
  }, [me, ready]);

  const selected = lowZoom ? null : (cats.find((c) => c.id === selectedId) ?? null);
  // 端末内の猫は正確な位置。クラウドの猫はプライバシーのため約1km単位に丸めてある
  const selectedIsApprox = !!selected && !localCats.some((c) => c.id === selected.id);
  const selectedDistance = selected && me ? distanceMeters(me, selected) : null;

  // ---- 選んだ猫と現在地を点線で結ぶ ----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource("me-line") as import("maplibre-gl").GeoJSONSource | undefined;
    if (!src) return;
    src.setData(
      selected && me
        ? {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: [[me.lng, me.lat], [selected.lng, selected.lat]] },
          }
        : { type: "FeatureCollection", features: [] },
    );
  }, [selected, me, ready]);

  // 現在地ボタン：現在地へ移動（猫を選んでいるときは、自分と猫が両方入るように）
  const goToMe = () => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml) return;
    if (!me) {
      setGeoNote((n) =>
        !("geolocation" in navigator) ? "この端末では現在地を使えません" : (n ?? "現在地を探しています…"),
      );
      return;
    }
    if (selected) {
      const b = new ml.LngLatBounds([me.lng, me.lat], [me.lng, me.lat]).extend([selected.lng, selected.lat]);
      map.fitBounds(b, { padding: { top: 120, bottom: 200, left: 60, right: 60 }, maxZoom: 17 });
    } else {
      map.flyTo({ center: [me.lng, me.lat], zoom: Math.max(map.getZoom(), 16) });
    }
  };

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
        <li className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full border-2 border-white bg-[#1a73e8] shadow-[0_0_0_3px_rgba(26,115,232,0.35)]" />
          現在地
        </li>
        {LEGEND.map((s) => (
          <li key={s} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full border-2 border-white" style={{ background: STATUS_COLOR[s] }} />
            {STATUS_LABEL[s]}
          </li>
        ))}
      </ul>

      {/* 現在地ボタン（右下・ミニカードを避ける） */}
      <button
        type="button"
        onClick={goToMe}
        aria-label={selected ? "現在地と猫を両方表示" : "現在地へ移動"}
        className="absolute right-3 z-10 grid h-12 w-12 place-items-center rounded-full bg-white text-[#1a73e8] shadow-[0_3px_12px_rgba(0,0,0,0.35)] transition-[bottom] active:scale-95"
        style={{ bottom: selected ? 138 : 28 }}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="8" />
          <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
        </svg>
      </button>
      {geoNote && (
        <p
          className="absolute right-3 z-10 max-w-[70%] rounded-2xl bg-black/75 px-3 py-2 text-[11px] font-medium text-white"
          style={{ bottom: (selected ? 138 : 28) + 56 }}
        >
          {geoNote}
        </p>
      )}

      {/* ピンをタップしたときのミニカード */}
      {selected && (
        <div className="sheet-up absolute inset-x-3 bottom-3 z-20 flex items-center gap-3 rounded-3xl bg-white p-3 text-stone-800 shadow-[0_8px_28px_rgba(0,0,0,0.4)]">
          <div className="relative h-[84px] w-[84px] shrink-0 overflow-hidden rounded-2xl" style={ginghamStyle(selected.patternId, 14)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={selected.stickerUrl} alt="" className="h-full w-full object-contain p-1.5" style={{ transform: "rotate(-4deg)" }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-extrabold">{selected.name}</p>
            <p className="truncate text-xs font-semibold text-stone-700">
              📍 {selected.placeName}
              {selectedIsApprox ? " あたり" : ""}で撮影
            </p>
            <p className="truncate text-xs text-stone-500">
              {relativeTime(selected.caughtAt)}
              {selectedDistance !== null && ` ・ 現在地から${selectedIsApprox ? "約" : ""}${formatDistance(selectedDistance)}`}
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
