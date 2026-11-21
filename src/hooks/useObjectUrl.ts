"use client";
import { useEffect, useState } from "react";

/** Blob を <img src> で使える URL にする。使い終わったら自動で解放する */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    // Blob から URL を作るのは外部リソースとの同期なので、effect 内の setState を許可
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      setUrl(null);
    };
  }, [blob]);
  return url;
}
