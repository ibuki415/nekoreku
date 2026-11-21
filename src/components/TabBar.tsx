"use client";
// 画面下に固定のタブバー。撮影画面では半透明の黒にして映像を邪魔しない

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CameraIcon, GridIcon, MapIcon, UserIcon } from "./icons";

const TABS = [
  { href: "/camera", label: "撮る", Icon: CameraIcon },
  { href: "/collection", label: "コレクション", Icon: GridIcon },
  { href: "/map", label: "地図", Icon: MapIcon },
  { href: "/account", label: "マイページ", Icon: UserIcon },
];

export default function TabBar() {
  const pathname = usePathname();
  const onCamera = pathname.startsWith("/camera");

  return (
    <nav
      className={`fixed inset-x-0 bottom-0 z-40 flex border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-md ${
        onCamera ? "border-white/10 bg-black/55" : "border-white/10 bg-[#111113]/92"
      }`}
      aria-label="メインメニュー"
    >
      {TABS.map(({ href, label, Icon }) => {
        const active = pathname.startsWith(href) || (href === "/collection" && pathname.startsWith("/cat/"));
        return (
          <Link
            key={href}
            href={href}
            className={`flex h-16 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              active ? "text-finder" : "text-stone-400"
            }`}
            aria-current={active ? "page" : undefined}
          >
            <Icon width={26} height={26} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
