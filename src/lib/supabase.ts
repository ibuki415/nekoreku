// Supabase クライアント（ブラウザ専用）。キーが無いときは null を返し、アプリは端末内モードで動く
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// NEXT_PUBLIC_ の値はビルド時に埋め込まれるので、process.env.〇〇 と直接書く必要がある
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** 両方の環境変数があるときだけ true（false なら端末内モード） */
export const isCloudEnabled: boolean = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

/** ブラウザでだけクライアントを作る（サーバー描画中は null）。セッションは localStorage に保存される */
export function getSupabase(): SupabaseClient | null {
  if (!isCloudEnabled || typeof window === "undefined") return null;
  if (!client) {
    client = createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return client;
}
