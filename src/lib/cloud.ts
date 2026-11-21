// クラウド（Supabase）とのやりとりをまとめたファイル。
// どの関数も「クラウド未設定 or 未ログイン」のときは安全に何もしない／空を返す。
// 端末内(IndexedDB)が自分の猫の正本。クラウドは共有用のコピー。
import { addCat, getCat, listCats, updateCat, type CatRecord } from "./db";
import { checkMember } from "./membership";
import { getSupabase } from "./supabase";

// ---- 行の型（supabase/schema.sql と対応。手書き） ----
export type CloudCatRow = {
  id: string;
  owner_id: string;
  name: string;
  image_path: string;
  background_style: string;
  lat: number | null;
  lng: number | null;
  place_name: string;
  country_code: string | null;
  caught_at: string;
  collect_count: number;
};

export type ProfileRow = { id: string; display_name: string };

export type CountryCount = { country_code: string; cat_count: number; lat: number; lng: number };

const BUCKET = "cat-stickers";
const CAT_COLUMNS =
  "id, owner_id, name, image_path, background_style, lat, lng, place_name, country_code, caught_at, collect_count";

/** 位置を小数第2位（約1km）に丸める。クラウドに送る値は必ずこれを通す */
export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function requireClient() {
  const sb = getSupabase();
  if (!sb) throw new Error("クラウド機能が有効ではありません");
  return sb;
}

/** 合言葉で参加済みのユーザー id（未ログイン・未参加・未設定なら null） */
export async function currentUserId(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    const uid = data.session?.user.id ?? null;
    if (!uid) return null;
    return (await checkMember(uid)) ? uid : null;
  } catch {
    return null;
  }
}

/** Storage の画像パス → 公開 URL */
export function publicImageUrl(path: string): string {
  return requireClient().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// ---- プロフィール ----
export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const sb = requireClient();
  const { data, error } = await sb.from("profiles").select("id, display_name").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data as ProfileRow | null) ?? null;
}

export async function updateDisplayName(userId: string, name: string): Promise<void> {
  const sb = requireClient();
  // 行が無い（SQL 実行前に登録したユーザー等）場合に備えて upsert
  const { error } = await sb.from("profiles").upsert({ id: userId, display_name: name }, { onConflict: "id" });
  if (error) throw error;
}

// ---- 自分の猫のアップロード・更新・削除 ----

/** 端末内の猫 1 匹をクラウドへ。画像 → cats 行の順。cats.id には端末内の id をそのまま使う（再送しても重複しない） */
export async function uploadCat(userId: string, cat: CatRecord): Promise<void> {
  const sb = requireClient();
  const path = `${userId}/${cat.id}.png`;
  const up = await sb.storage.from(BUCKET).upload(path, cat.sticker, {
    contentType: "image/png",
    upsert: true,
  });
  if (up.error) throw up.error;

  const { error } = await sb.from("cats").upsert(
    {
      id: cat.id,
      name: cat.name.slice(0, 30),
      image_path: path,
      background_style: cat.background_style,
      // 正確な位置は端末の外へ出さない：丸めた値だけ送る
      lat: cat.lat === null ? null : round2(cat.lat),
      lng: cat.lng === null ? null : round2(cat.lng),
      place_name: cat.place_name,
      country_code: cat.country_code,
      caught_at: cat.caught_at,
    },
    { onConflict: "id" },
  );
  if (error) throw error;
  await updateCat(cat.id, { remote_id: cat.id });
}

/** 保存直後の自動アップロード。ログインしていなければ何もしない。失敗しても端末内には残る */
export async function syncCatIfLoggedIn(catId: string): Promise<boolean> {
  try {
    const uid = await currentUserId();
    if (!uid) return false;
    const cat = await getCat(catId);
    if (!cat) return false;
    await uploadCat(uid, cat);
    return true;
  } catch (e) {
    console.error("クラウドへの保存に失敗", e);
    return false;
  }
}

/** 名前変更をクラウドへ（同期済みの猫だけ）。失敗しても無視 */
export async function syncRename(cat: CatRecord): Promise<void> {
  if (!cat.remote_id) return;
  try {
    const sb = getSupabase();
    if (!sb || !(await currentUserId())) return;
    await sb.from("cats").update({ name: cat.name.slice(0, 30) }).eq("id", cat.remote_id);
  } catch (e) {
    console.error("名前の同期に失敗", e);
  }
}

/** 削除をクラウドへ（同期済みの猫だけ）。画像 → 行の順。失敗しても無視 */
export async function syncDelete(cat: CatRecord): Promise<void> {
  if (!cat.remote_id) return;
  try {
    const sb = getSupabase();
    const uid = await currentUserId();
    if (!sb || !uid) return;
    await sb.storage.from(BUCKET).remove([`${uid}/${cat.remote_id}.png`]);
    await sb.from("cats").delete().eq("id", cat.remote_id);
  } catch (e) {
    console.error("削除の同期に失敗", e);
  }
}

/** まだクラウドに上がっていない端末内の猫を全部送る。戻り値は成功数と失敗数 */
export async function uploadUnsynced(
  userId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: number; failed: number }> {
  const targets = (await listCats()).filter((c) => !c.remote_id);
  let ok = 0;
  let failed = 0;
  for (const cat of targets) {
    try {
      await uploadCat(userId, cat);
      ok++;
    } catch (e) {
      console.error(e);
      failed++;
    }
    onProgress?.(ok + failed, targets.length);
  }
  return { ok, failed };
}

/** クラウドにある自分の猫のうち、端末内に無いものを取り込む（別端末でログインしたとき用） */
export async function importMyCats(
  userId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: number; failed: number }> {
  const sb = requireClient();
  const { data, error } = await sb
    .from("cats")
    .select(CAT_COLUMNS)
    .eq("owner_id", userId)
    .order("caught_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []) as CloudCatRow[];
  const have = new Set((await listCats()).flatMap((c) => [c.id, c.remote_id ?? ""]));
  const targets = rows.filter((r) => !have.has(r.id));
  let ok = 0;
  let failed = 0;
  for (const r of targets) {
    try {
      const res = await fetch(publicImageUrl(r.image_path));
      if (!res.ok) throw new Error(`画像を取得できません (${res.status})`);
      const sticker = await res.blob();
      await addCat({
        id: r.id,
        name: r.name,
        sticker,
        background_style: r.background_style as CatRecord["background_style"],
        // クラウドの値は丸め済み（約1km精度）。端末内の正確な位置は復元できない
        lat: r.lat,
        lng: r.lng,
        place_name: r.place_name,
        country_code: r.country_code,
        caught_at: r.caught_at,
        remote_id: r.id,
      });
      ok++;
    } catch (e) {
      console.error(e);
      failed++;
    }
    onProgress?.(ok + failed, targets.length);
  }
  return { ok, failed };
}

// ---- 地図・カード詳細用の読み取り ----

/** 表示範囲内の猫（新しい順・最大300） */
export async function fetchCatsInBounds(b: {
  south: number;
  north: number;
  west: number;
  east: number;
}): Promise<CloudCatRow[]> {
  const sb = requireClient();
  let q = sb
    .from("cats")
    .select(CAT_COLUMNS)
    .gte("lat", Math.max(-90, b.south))
    .lte("lat", Math.min(90, b.north))
    .gte("lng", Math.max(-180, b.west))
    .lte("lng", Math.min(180, b.east));
  q = q.order("caught_at", { ascending: false }).limit(300);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CloudCatRow[];
}

/** 国ごとの件数（country_counts() を呼ぶ） */
export async function fetchCountryCounts(): Promise<CountryCount[]> {
  const sb = requireClient();
  const { data, error } = await sb.rpc("country_counts");
  if (error) throw error;
  const rows = (data ?? []) as {
    country_code: string;
    cat_count: number | string; // bigint は文字列で来ることがあるので数値化する
    lat: number;
    lng: number;
  }[];
  return rows.map((r) => ({ ...r, cat_count: Number(r.cat_count) }));
}

/** 自分がコレクトした猫の id 一覧 */
export async function fetchMyCollectedIds(userId: string): Promise<Set<string>> {
  const sb = requireClient();
  const { data, error } = await sb.from("collections").select("cat_id").eq("user_id", userId).limit(2000);
  if (error) throw error;
  return new Set(((data ?? []) as { cat_id: string }[]).map((r) => r.cat_id));
}

export async function fetchCloudCat(id: string): Promise<CloudCatRow | null> {
  const sb = requireClient();
  const { data, error } = await sb.from("cats").select(CAT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as CloudCatRow | null) ?? null;
}

/** 自分がコレクトした猫（集めた順）。cats を埋め込みで一緒に取る */
export async function listCollectedCats(userId: string): Promise<CloudCatRow[]> {
  const sb = requireClient();
  const { data, error } = await sb
    .from("collections")
    .select(`collected_at, cats (${CAT_COLUMNS})`)
    .eq("user_id", userId)
    .order("collected_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []) as unknown as { cats: CloudCatRow | CloudCatRow[] | null }[];
  return rows.flatMap((r) => (Array.isArray(r.cats) ? r.cats : r.cats ? [r.cats] : []));
}

// ---- コレクト ----
export async function collectCat(userId: string, catId: string): Promise<void> {
  const sb = requireClient();
  const { error } = await sb.from("collections").insert({ user_id: userId, cat_id: catId });
  // 23505 = すでにコレクト済み（二重タップなど）。成功扱い
  if (error && error.code !== "23505") throw error;
}

export async function uncollectCat(userId: string, catId: string): Promise<void> {
  const sb = requireClient();
  const { error } = await sb.from("collections").delete().eq("user_id", userId).eq("cat_id", catId);
  if (error) throw error;
}
