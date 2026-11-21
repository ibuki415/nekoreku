import { Suspense } from "react";
import CatRoute from "@/components/CatRoute";

// cacheComponents が有効なので、params（URLの [id]）は「実行時のデータ」。
// 読むのは Suspense の内側だけにして、外側（枠）は事前に作れるようにする。
// CatRoute 内の useSearchParams（?src=cloud）も同じ Suspense が受け止める
export default function CatPage({ params }: PageProps<"/cat/[id]">) {
  return (
    <Suspense fallback={<p className="p-10 text-center text-sm text-stone-500">読み込み中…</p>}>
      {params.then(({ id }) => (
        <CatRoute id={id} />
      ))}
    </Suspense>
  );
}
