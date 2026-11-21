import { Suspense } from "react";
import MapScreen from "@/components/map/MapScreen";

// MapScreen は URL の ?focus= を読むので Suspense で包む（cacheComponents では必須）
export default function MapPage() {
  return (
    <Suspense fallback={<p className="p-10 text-center text-sm text-stone-500">読み込み中…</p>}>
      <MapScreen />
    </Suspense>
  );
}
