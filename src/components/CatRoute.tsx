"use client";
// /cat/[id] の入口：?src=cloud ならクラウドの猫（他人のカード）、それ以外は端末内の猫を表示する
// useSearchParams を使うので、呼び出し側（page.tsx）で Suspense に包んでいる

import { useSearchParams } from "next/navigation";
import CatDetail from "./CatDetail";
import CloudCatDetail from "./CloudCatDetail";

export default function CatRoute({ id }: { id: string }) {
  const src = useSearchParams().get("src");
  return src === "cloud" ? <CloudCatDetail id={id} /> : <CatDetail id={id} />;
}
