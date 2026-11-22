// 端末内データベース(IndexedDB)。撮った猫はここに保存する（元写真は保存しない）
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { PatternId } from "./patterns";

export type CatRecord = {
  id: string; // crypto.randomUUID()
  name: string; // 1〜30文字
  sticker: Blob; // 白フチ・影つき切り抜きPNG（背景透過）
  background_style: PatternId;
  lat: number | null; // 端末内は正確な値。クラウドに送るときだけ丸める
  lng: number | null;
  place_name: string; // 例「渋谷区 神南」。取れなければ「場所不明」
  country_code: string | null; // "JP" など
  caught_at: string; // ISO文字列
  remote_id?: string | null; // 将来のクラウド同期用
};

// iPhone のホーム画面アプリ（PWA）では、IndexedDB に Blob をそのまま入れると
// 「Error preparing Blob/File data to be stored in object store」で失敗することがある（WebKit の不具合）。
// そこで画像は「バイト列（ArrayBuffer）＋種類」の形で保存し、読み出すときに Blob に戻す。
// 以前 Blob のまま保存した猫も、そのまま読めるようにしてある。
type StoredSticker = Blob | { bytes: ArrayBuffer; type: string };
type StoredCat = Omit<CatRecord, "sticker"> & { sticker: StoredSticker };

async function toStored(cat: CatRecord): Promise<StoredCat> {
  const sticker = cat.sticker as StoredSticker;
  if (!(sticker instanceof Blob)) return cat as StoredCat;
  return { ...cat, sticker: { bytes: await sticker.arrayBuffer(), type: sticker.type || "image/png" } };
}

function fromStored(cat: StoredCat): CatRecord;
function fromStored(cat: StoredCat | undefined): CatRecord | undefined;
function fromStored(cat: StoredCat | undefined): CatRecord | undefined {
  if (!cat) return undefined;
  const s = cat.sticker;
  if (s instanceof Blob) return cat as CatRecord;
  return { ...cat, sticker: new Blob([s.bytes], { type: s.type }) };
}

interface NekorekuDB extends DBSchema {
  cats: {
    key: string;
    value: StoredCat;
    indexes: { caught_at: string };
  };
}

let dbPromise: Promise<IDBPDatabase<NekorekuDB>> | null = null;

// 初めて使うときに1回だけ開く（ブラウザ専用なので呼ぶのは effect / イベント内だけ）
function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<NekorekuDB>("nekoreku", 1, {
      upgrade(db) {
        const store = db.createObjectStore("cats", { keyPath: "id" });
        store.createIndex("caught_at", "caught_at");
      },
    });
  }
  return dbPromise;
}

export async function addCat(cat: CatRecord): Promise<void> {
  const db = await getDb();
  const stored = await toStored(cat); // await はトランザクションを開く前に済ませる
  await db.put("cats", stored);
}

/** 新しい順の一覧 */
export async function listCats(): Promise<CatRecord[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex("cats", "caught_at");
  return all.reverse().map((c) => fromStored(c));
}

/** 一番新しい1匹（カメラ画面のサムネ用。全件読まずに済む） */
export async function latestCat(): Promise<CatRecord | undefined> {
  const db = await getDb();
  const cursor = await db.transaction("cats").store.index("caught_at").openCursor(null, "prev");
  return fromStored(cursor?.value);
}

export async function getCat(id: string): Promise<CatRecord | undefined> {
  const db = await getDb();
  return fromStored(await db.get("cats", id));
}

export async function updateCat(id: string, patch: Partial<Omit<CatRecord, "id">>) {
  const db = await getDb();
  const cur = fromStored(await db.get("cats", id));
  if (!cur) return undefined;
  const next: CatRecord = { ...cur, ...patch };
  await db.put("cats", await toStored(next));
  return next;
}

export async function deleteCat(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("cats", id);
}

export async function countCats(): Promise<number> {
  const db = await getDb();
  return db.count("cats");
}
