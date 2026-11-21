"use client";
// ログイン状態を返すフック。クラウド未設定のときは常に「未ログイン・読み込み済み」。
// 「ログイン中（user がある）」＝ アカウントがあって、合言葉で参加済み。
// アカウントはあるが合言葉がまだ（または違った）ときは user は null、pendingUser にだけ入る
import type { Session, User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { checkMember, MEMBER_EVENT } from "@/lib/membership";
import { getSupabase, isCloudEnabled } from "@/lib/supabase";

export type SessionState = {
  session: Session | null;
  user: User | null; // 参加済みのユーザー
  pendingUser: User | null; // アカウントはあるが未参加のユーザー
  loading: boolean; // 確認中
};

type Inner = { session: Session | null; member: boolean; loading: boolean };

export function useSession(): SessionState {
  const [state, setState] = useState<Inner>({ session: null, member: false, loading: isCloudEnabled });

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let alive = true;
    let seq = 0;

    const apply = async (session: Session | null) => {
      const mySeq = ++seq;
      if (!session) {
        if (alive) setState({ session: null, member: false, loading: false });
        return;
      }
      let member = false;
      try {
        member = await checkMember(session.user.id);
      } catch {
        member = false; // 通信できないときは未参加扱い（あとでまた確かめる）
      }
      if (alive && mySeq === seq) setState({ session, member, loading: false });
    };

    sb.auth
      .getSession()
      .then(({ data }) => apply(data.session))
      .catch(() => alive && setState({ session: null, member: false, loading: false }));
    // ログイン・ログアウト・トークン更新のたびに反映する
    const { data } = sb.auth.onAuthStateChange((_event, session) => {
      void apply(session);
    });
    // 合言葉で参加したら、すぐ反映する
    const onJoined = () => {
      sb.auth.getSession().then(({ data: d }) => apply(d.session));
    };
    window.addEventListener(MEMBER_EVENT, onJoined);
    return () => {
      alive = false;
      data.subscription.unsubscribe();
      window.removeEventListener(MEMBER_EVENT, onJoined);
    };
  }, []);

  const raw = state.session?.user ?? null;
  return {
    session: state.session,
    user: state.member ? raw : null,
    pendingUser: state.member ? null : raw,
    loading: state.loading,
  };
}
