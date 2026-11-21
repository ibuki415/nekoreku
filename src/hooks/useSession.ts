"use client";
// ログイン状態を返すフック。クラウド未設定のときは常に「未ログイン・読み込み済み」
import type { Session, User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { getSupabase, isCloudEnabled } from "@/lib/supabase";

export type SessionState = {
  session: Session | null;
  user: User | null;
  loading: boolean; // セッションの確認中
};

export function useSession(): SessionState {
  const [state, setState] = useState<{ session: Session | null; loading: boolean }>({
    session: null,
    loading: isCloudEnabled,
  });

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let alive = true;
    sb.auth
      .getSession()
      .then(({ data }) => alive && setState({ session: data.session, loading: false }))
      .catch(() => alive && setState({ session: null, loading: false }));
    // ログイン・ログアウト・トークン更新のたびに反映する
    const { data } = sb.auth.onAuthStateChange((_event, session) => {
      if (alive) setState({ session, loading: false });
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return { session: state.session, user: state.session?.user ?? null, loading: state.loading };
}
