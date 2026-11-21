// 合言葉で参加済みかどうか（Supabase の is_member() に聞く）。
// 同じユーザーについて何度も聞かないよう、結果を覚えておく（失敗したときは覚えない）
import { getSupabase } from "./supabase";

const cache = new Map<string, Promise<boolean>>();

export function checkMember(userId: string): Promise<boolean> {
  const hit = cache.get(userId);
  if (hit) return hit;
  const sb = getSupabase();
  if (!sb) return Promise.resolve(false);
  const p = (async () => {
    const { data, error } = await sb.rpc("is_member");
    if (error) throw error;
    return data === true;
  })();
  cache.set(userId, p);
  p.then(
    (ok) => {
      if (!ok) cache.delete(userId); // 「まだ未参加」は覚えない（参加したらすぐ反映させるため）
    },
    () => cache.delete(userId),
  );
  return p;
}

/** 合言葉を確かめて参加する。true なら参加できた */
export async function joinWithPassphrase(passphrase: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) throw new Error("クラウド機能が有効ではありません");
  // まだアカウントが無ければ、名無しのアカウント（匿名ログイン）を作る
  const { data: s } = await sb.auth.getSession();
  if (!s.session) {
    const { error } = await sb.auth.signInAnonymously();
    if (error) throw error;
  }
  const { data, error } = await sb.rpc("join_with_passphrase", { p: passphrase });
  if (error) throw error;
  if (data !== true) return false;
  const { data: s2 } = await sb.auth.getSession();
  const uid = s2.session?.user.id;
  if (uid) cache.set(uid, Promise.resolve(true));
  // 画面のあちこちにある useSession に「参加した」ことを知らせる
  window.dispatchEvent(new Event(MEMBER_EVENT));
  return true;
}

export const MEMBER_EVENT = "nekoreku:member-joined";
