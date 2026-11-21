"use client";
// ↑「このファイルはブラウザ側で動かす」という印。カメラや位置情報はブラウザにしかないため必要

import { useEffect, useState } from "react";

type Check = { label: string; ok: boolean; hint: string };

export default function EnvCheck() {
  const [checks, setChecks] = useState<Check[] | null>(null);

  useEffect(() => {
    // ページが画面に出た後に1回だけ、ブラウザの機能を調べる
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChecks([
      {
        label: "HTTPS で開いている",
        ok: window.isSecureContext,
        hint: "http:// だとカメラと位置情報が使えません",
      },
      {
        label: "カメラが使える",
        ok: !!navigator.mediaDevices?.getUserMedia,
        hint: "HTTPS で開き直してください",
      },
      {
        label: "位置情報が使える",
        ok: "geolocation" in navigator,
        hint: "HTTPS で開き直してください",
      },
      {
        label: "ホーム画面から起動している",
        ok: standalone,
        hint: "任意。共有ボタン →「ホーム画面に追加」でアプリのように使えます",
      },
    ]);
  }, []);

  if (!checks) return <p className="text-stone-500">確認中…</p>;

  return (
    <section className="w-full max-w-sm rounded-2xl border border-stone-800 bg-stone-900/60 p-5">
      <h2 className="mb-3 text-sm font-semibold text-stone-300">動作環境チェック</h2>
      <ul className="space-y-3">
        {checks.map((c) => (
          <li key={c.label} className="flex gap-3">
            <span className={c.ok ? "text-detect" : "text-finder"}>{c.ok ? "✔" : "✖"}</span>
            <div>
              <p>{c.label}</p>
              {!c.ok && <p className="text-xs text-stone-400">{c.hint}</p>}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-stone-500">{navigator.userAgent}</p>
    </section>
  );
}
