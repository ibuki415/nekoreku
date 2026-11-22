"use client";
// マイページ：合言葉で参加・表示名・クラウド同期。
// クラウド未設定のときは案内だけ出す（端末内モード）

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { describeError, fetchProfile, importMyCats, updateDisplayName, uploadUnsynced } from "@/lib/cloud";
import { listCats } from "@/lib/db";
import { joinWithPassphrase } from "@/lib/membership";
import { getSupabase, isCloudEnabled } from "@/lib/supabase";
import EnvCheck from "../EnvCheck";

// 参加時のエラーを日本語にする（code / status / message のどれかで判定）
function joinErrorMessage(e: unknown): string {
  const err = e as { code?: string; status?: number; message?: string } | null;
  const code = err?.code ?? "";
  const msg = (err?.message ?? "").toLowerCase();
  if (msg.includes("too_many_attempts")) {
    return "合言葉のまちがいが続いたので、しばらく受け付けていません。15分ほど待ってからやり直してください。";
  }
  if (msg.includes("passphrase_not_set")) {
    return "合言葉がまだ設定されていません（管理者は docs/SUPABASE_SETUP.md の手順を確認してください）。";
  }
  if (code.includes("anonymous_provider_disabled") || msg.includes("anonymous sign-ins are disabled")) {
    return "Supabase の「匿名ログイン」がオフになっています（管理者向け: docs/SUPABASE_SETUP.md）。";
  }
  if (err?.status === 429 || code.includes("rate_limit") || msg.includes("rate limit") || msg.includes("too many")) {
    return "短時間に何度も試されました。少し待ってからやり直してください。";
  }
  if (msg.includes("fetch") || msg.includes("network")) {
    return "通信できませんでした。ネットワークを確認してください。";
  }
  return "うまくいきませんでした。しばらくしてからもう一度お試しください。";
}

const card = "w-full max-w-sm rounded-3xl bg-white/[0.06] p-5";
const input =
  "h-12 w-full rounded-2xl bg-white px-4 text-[16px] text-stone-900 outline-none focus:ring-2 focus:ring-finder";
const primaryBtn =
  "grid h-12 w-full place-items-center rounded-full bg-finder text-[15px] font-bold text-black disabled:opacity-60";

export default function AccountView() {
  return (
    <main className="flex flex-1 flex-col items-center gap-5 px-5 pt-[calc(env(safe-area-inset-top)+24px)] pb-[calc(var(--tabbar-h)+24px)]">
      <h1 className="text-2xl font-extrabold">マイページ</h1>
      {isCloudEnabled ? <CloudAccount /> : <LocalOnlyNotice />}
      <EnvCheck />
    </main>
  );
}

function LocalOnlyNotice() {
  return (
    <section className={card}>
      <p className="text-[15px] font-bold">クラウド機能は未設定です</p>
      <p className="mt-2 text-sm leading-relaxed text-stone-400">
        いまは猫がこの端末の中だけに保存される「端末内モード」です。みんなの猫を見たり、コレクトしたりするには
        docs/SUPABASE_SETUP.md の手順でクラウドを設定してください。
      </p>
    </section>
  );
}

function CloudAccount() {
  const { user, loading } = useSession();
  if (loading) return <p className="text-sm text-stone-500">読み込み中…</p>;
  return user ? <Profile userId={user.id} /> : <JoinForm />;
}

// ---------- 参加（みんな共通の合言葉） ----------
function JoinForm() {
  const [word, setWord] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const join = async () => {
    const w = word.trim();
    if (!w) return;
    setBusy(true);
    setError("");
    try {
      const ok = await joinWithPassphrase(w);
      if (!ok) setError("合言葉が違います。");
      // 成功すると useSession が変化を検知して画面が切り替わる
    } catch (e) {
      setError(joinErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${card} flex flex-col gap-3`}>
      <p className="text-[15px] font-bold">合言葉で参加</p>
      <p className="text-sm leading-relaxed text-stone-400">
        仲間うちの合言葉を入れると、みんなの猫を地図で見たり、コレクトしたりできます。メールアドレスは要りません。
      </p>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={word}
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void join()}
          placeholder="合言葉"
          aria-label="合言葉"
          className={`${input} pr-16`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute inset-y-0 right-3 text-xs font-semibold text-stone-500"
        >
          {show ? "隠す" : "表示"}
        </button>
      </div>
      <button type="button" onClick={join} disabled={busy || !word.trim()} className={primaryBtn}>
        {busy ? "確認中…" : "参加する"}
      </button>
      {error && <p className="text-xs leading-relaxed text-red-400">{error}</p>}
    </section>
  );
}

// ---------- ログイン後 ----------
function Profile({ userId }: { userId: string }) {
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [nameMsg, setNameMsg] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [unsynced, setUnsynced] = useState<number | null>(null);
  const [localTotal, setLocalTotal] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  // 表示名の読み込み
  useEffect(() => {
    let alive = true;
    fetchProfile(userId)
      .then((p) => {
        if (!alive) return;
        setName(p?.display_name ?? "");
        setDraft(p?.display_name ?? "");
      })
      .catch(() => alive && setNameMsg("表示名を読み込めませんでした。"));
    return () => {
      alive = false;
    };
  }, [userId]);

  // 未同期の数を数える
  const refreshCounts = useCallback(async () => {
    try {
      const cats = await listCats();
      setLocalTotal(cats.length);
      setUnsynced(cats.filter((c) => !c.remote_id).length);
    } catch {
      setUnsynced(null);
    }
  }, []);
  useEffect(() => {
    // IndexedDB の件数を読む（外部システムとの同期）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshCounts();
  }, [refreshCounts]);

  const saveName = async () => {
    const v = draft.trim();
    if (v.length < 1 || v.length > 20) {
      setNameMsg("表示名は1〜20文字で入れてください。");
      return;
    }
    setSavingName(true);
    setNameMsg("");
    try {
      await updateDisplayName(userId, v);
      setName(v);
      setNameMsg("保存しました。");
    } catch {
      setNameMsg("保存できませんでした。もう一度お試しください。");
    } finally {
      setSavingName(false);
    }
  };

  const upload = async () => {
    setSyncing(true);
    setSyncMsg("");
    try {
      const r = await uploadUnsynced(userId, (d, t) => setSyncMsg(`保存中… ${d}/${t}`));
      setSyncMsg(
        r.failed
          ? `${r.ok}匹を保存、${r.failed}匹は失敗しました。もう一度試せます。（理由: ${r.firstError ?? "不明"}）`
          : `${r.ok}匹をクラウドに保存しました。`,
      );
    } catch (e) {
      setSyncMsg(`保存できませんでした。通信状況を確認してください。（理由: ${describeError(e)}）`);
    } finally {
      setSyncing(false);
      void refreshCounts();
    }
  };

  const importAll = async () => {
    setSyncing(true);
    setSyncMsg("");
    try {
      const r = await importMyCats(userId, (d, t) => setSyncMsg(`取り込み中… ${d}/${t}`));
      setSyncMsg(
        r.ok === 0 && r.failed === 0
          ? "取り込む猫はありませんでした。"
          : r.failed
            ? `${r.ok}匹を取り込み、${r.failed}匹は失敗しました。`
            : `${r.ok}匹を取り込みました。`,
      );
    } catch {
      setSyncMsg("取り込めませんでした。通信状況を確認してください。");
    } finally {
      setSyncing(false);
      void refreshCounts();
    }
  };

  // 匿名アカウントなので、ログアウトすると二度と同じアカウントに戻れない。必ず確認する
  const logout = async () => {
    const ok = window.confirm(
      "この端末から参加をやめます。\n\n" +
        "メール登録の無いアカウントなので、もう一度合言葉を入れても「別の人」として扱われます。" +
        "クラウドに保存した猫は、あなたの猫として編集・削除できなくなります（端末内の猫は残ります）。\n\n" +
        "本当にやめますか？",
    );
    if (!ok) return;
    await getSupabase()?.auth.signOut();
  };

  return (
    <>
      <section className={`${card} flex flex-col gap-3`}>
        <p className="text-[15px] font-bold">参加中</p>
        <p className="text-xs leading-relaxed text-stone-400">
          アカウントはこの端末（このブラウザ）の中にあります。Safari の履歴とデータを消したり、機種変更したりすると元に戻せません。
        </p>
        <label className="text-xs text-stone-400" htmlFor="display-name">
          表示名（他の人に見えます）
        </label>
        <div className="flex gap-2">
          <input
            id="display-name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={20}
            disabled={name === null}
            className={`${input} min-w-0 flex-1`}
          />
          <button
            type="button"
            onClick={saveName}
            disabled={savingName || name === null || draft.trim() === name}
            className="h-12 rounded-2xl bg-finder px-5 text-sm font-bold text-black disabled:opacity-50"
          >
            保存
          </button>
        </div>
        {nameMsg && <p className="text-xs text-stone-300">{nameMsg}</p>}
      </section>

      <section className={`${card} flex flex-col gap-3`}>
        <p className="text-[15px] font-bold">クラウド同期</p>
        <p className="text-sm text-stone-400">
          端末内の猫: {unsynced === null ? "…" : `${localTotal}匹（未同期 ${unsynced}匹）`}
        </p>
        <button type="button" onClick={upload} disabled={syncing || !unsynced} className={primaryBtn}>
          端末内の猫をクラウドに保存（未同期 {unsynced ?? 0}匹）
        </button>
        <button
          type="button"
          onClick={importAll}
          disabled={syncing}
          className="grid h-12 w-full place-items-center rounded-full bg-white/10 text-[15px] font-semibold disabled:opacity-60"
        >
          クラウドから取り込む
        </button>
        {syncMsg && <p className="text-xs text-stone-300">{syncMsg}</p>}
        <p className="text-[11px] leading-relaxed text-stone-500">
          クラウドには約1km精度に丸めた位置だけが送られます。正確な位置はこの端末の中だけに残ります。
        </p>
      </section>

      <button type="button" onClick={logout} className="h-11 px-6 text-sm text-stone-400 underline underline-offset-2">
        参加をやめる（ログアウト）
      </button>
    </>
  );
}
