"use client";
// マイページ：ログイン（メールの6桁コード）・表示名・クラウド同期。
// クラウド未設定のときは案内だけ出す（端末内モード）

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { fetchProfile, importMyCats, updateDisplayName, uploadUnsynced } from "@/lib/cloud";
import { listCats } from "@/lib/db";
import { getSupabase, isCloudEnabled } from "@/lib/supabase";
import EnvCheck from "../EnvCheck";

// supabase-js のエラーを日本語にする（code / status / message のどれかで判定）
function authErrorMessage(e: unknown): string {
  const err = e as { code?: string; status?: number; message?: string } | null;
  const code = err?.code ?? "";
  const msg = (err?.message ?? "").toLowerCase();
  if (code === "otp_expired" || msg.includes("expired") || msg.includes("invalid")) {
    return "コードが違うか、期限が切れています。もう一度確かめるか、コードを再送してください。";
  }
  if (
    err?.status === 429 ||
    code.includes("rate_limit") ||
    msg.includes("rate limit") ||
    msg.includes("too many") ||
    msg.includes("security purposes")
  ) {
    return "短時間に何度も送られました。少し待ってからやり直してください。";
  }
  if (code === "validation_failed" || msg.includes("email")) {
    return "メールアドレスを確かめてください。";
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
  return user ? <Profile userId={user.id} email={user.email ?? ""} /> : <LoginForm />;
}

// ---------- ログイン（メール → 6桁コード） ----------
function LoginForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const sendCode = async () => {
    const sb = getSupabase();
    const addr = email.trim();
    if (!sb) return;
    if (!/^\S+@\S+\.\S+$/.test(addr)) {
      setError("メールアドレスを確かめてください。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: err } = await sb.auth.signInWithOtp({ email: addr, options: { shouldCreateUser: true } });
      if (err) throw err;
      setStep("code");
      setInfo(`${addr} に6桁のコードを送りました。`);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const sb = getSupabase();
    const token = code.replace(/\s/g, "");
    if (!sb) return;
    if (!/^\d{6}$/.test(token)) {
      setError("6桁の数字を入れてください。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: err } = await sb.auth.verifyOtp({ email: email.trim(), token, type: "email" });
      if (err) throw err;
      // 成功すると useSession が変化を検知して画面が切り替わる
    } catch (e) {
      setError(authErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <section className={`${card} flex flex-col gap-3`}>
      <p className="text-[15px] font-bold">ログイン</p>
      {step === "email" ? (
        <>
          <p className="text-sm leading-relaxed text-stone-400">
            メールアドレスにコードを送ります。パスワードは要りません。はじめての方は自動で登録されます。
          </p>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="メールアドレス"
            className={input}
          />
          <button type="button" onClick={sendCode} disabled={busy || !email} className={primaryBtn}>
            {busy ? "送信中…" : "コードを送る"}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-stone-400">{info} メールに書かれた数字を入れてください。</p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            aria-label="6桁のコード"
            className={`${input} text-center text-[22px] tracking-[0.4em]`}
          />
          <button type="button" onClick={verify} disabled={busy || code.length !== 6} className={primaryBtn}>
            {busy ? "確認中…" : "ログイン"}
          </button>
          <div className="flex justify-between text-xs text-stone-400">
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setError("");
              }}
              className="py-2 underline underline-offset-2"
            >
              メールアドレスを変える
            </button>
            <button type="button" onClick={sendCode} disabled={busy} className="py-2 underline underline-offset-2">
              コードを再送
            </button>
          </div>
        </>
      )}
      {error && <p className="text-xs leading-relaxed text-red-400">{error}</p>}
    </section>
  );
}

// ---------- ログイン後 ----------
function Profile({ userId, email }: { userId: string; email: string }) {
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
      setSyncMsg(r.failed ? `${r.ok}匹を保存、${r.failed}匹は失敗しました。もう一度試せます。` : `${r.ok}匹をクラウドに保存しました。`);
    } catch {
      setSyncMsg("保存できませんでした。通信状況を確認してください。");
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

  const logout = async () => {
    await getSupabase()?.auth.signOut();
  };

  return (
    <>
      <section className={`${card} flex flex-col gap-3`}>
        <p className="text-[15px] font-bold">ログイン中</p>
        <p className="break-all text-xs text-stone-400">{email}</p>
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
        ログアウト
      </button>
    </>
  );
}
