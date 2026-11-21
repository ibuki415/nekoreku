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

interface NekorekuDB extends DBSchema {
  cats: {
    key: string;
    value: CatRecord;
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
  await db.put("cats", cat);
}

/** 新しい順の一覧 */
export async function listCats(): Promise<CatRecord[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex("cats", "caught_at");
  return all.reverse();
}

/** 一番新しい1匹（カメラ画面のサムネ用。全件読まずに済む） */
export async function latestCat(): Promise<CatRecord | undefined> {
  const db = await getDb();
  const cursor = await db.transaction("cats").store.index("caught_at").openCursor(null, "prev");
  return cursor?.value;
}

export async function getCat(id: string): Promise<CatRecord | undefined> {
  const db = await getDb();
  return db.get("cats", id);
}

export async function updateCat(id: string, patch: Partial<Omit<CatRecord, "id">>) {
  const db = await getDb();
  const cur = await db.get("cats", id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch };
  await db.put("cats", next);
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
