// 位置情報と、緯度経度→地名の変換

export type Position = { lat: number; lng: number };

/** 現在地を取る。拒否・失敗・タイムアウトなら null */
export function getPosition(timeoutMs = 10000): Promise<Position | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}

export type Place = { place_name: string; country_code: string | null };

const UNKNOWN: Place = { place_name: "場所不明", country_code: null };

/** OSM Nominatim で地名を取る。利用規約により「1撮影につき1回」だけ呼ぶこと */
export async function reverseGeocode(lat: number, lng: number): Promise<Place> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${lat}&lon=${lng}&zoom=16&accept-language=ja`;
    const res = await fetch(url);
    if (!res.ok) return UNKNOWN;
    const json = await res.json();
    const a = json.address ?? {};
    const city = a.city || a.town || a.village || a.county || "";
    const ward = a.city_district || a.suburb || a.quarter || a.neighbourhood || "";
    const name = [city, ward].filter(Boolean).join(" ");
    return {
      place_name: name || "場所不明",
      country_code: typeof a.country_code === "string" ? a.country_code.toUpperCase() : null,
    };
  } catch {
    return UNKNOWN;
  }
}

export type Located = { pos: Position | null; place: Place };

/** 現在地 → 地名 までをまとめて行う（撮影ボタンを押した瞬間に開始する） */
export async function locate(): Promise<Located> {
  const pos = await getPosition();
  if (!pos) return { pos: null, place: UNKNOWN };
  return { pos, place: await reverseGeocode(pos.lat, pos.lng) };
}
