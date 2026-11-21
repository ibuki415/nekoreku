# ネコレク（仮）

街の猫を撮って、ステッカーカードにして集める PWA。Next.js 16 + TypeScript + Tailwind v4。

## PC で開く

```
npm run dev
```

→ http://localhost:3029

## iPhone 実機で開く（HTTPS が必要）

カメラと位置情報は HTTPS でしか動かないため、Cloudflare の一時トンネルを使う。

1. ターミナル1: `npm run dev`
2. ターミナル2: `npm run tunnel`
3. ターミナル2に出る `https://〇〇〇.trycloudflare.com` を iPhone の Safari で開く
   （URL は起動するたびに変わる。PC と iPhone は別の回線でも OK）
4. 任意: 共有ボタン →「ホーム画面に追加」でアプリのように起動できる

止めるときは各ターミナルで Ctrl+C。

## 開発フェーズ

1. 環境準備 ← 済
2. カメラ画面 ← 実装済
3. 猫の検出（MediaPipe）← 実装済
4. 背景除去（@imgly/background-removal）とカード化 ← 実装済
5. 保存（IndexedDB）とコレクション一覧 ← 実装済
6. 地図表示（MapLibre）← 実装済
7. クラウド化（Supabase）← 実装済（設定は [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)。未設定でも端末内モードで動く）
8. ソーシャル機能（みんなの猫の地図・コレクト・シェア画像）← 実装済（クラウド設定後に有効）

## ライセンス・利用規約の注意

- 背景除去に使っている **@imgly/background-removal は AGPL ライセンス**です。公開サービスにする場合は、ソースコード公開の義務など AGPL の条件を確認してください（商用の別ライセンスもあります）。
- 地名の取得に **OpenStreetMap の Nominatim** を使っています。利用規約により「1秒に1回まで」「アプリを識別できること」が求められます。1回の撮影につき1回だけ呼ぶ作り方にしています。
- 地図は OpenFreeMap（無料）です。地図右下の帰属表示（© OpenStreetMap contributors など）は消さないでください。
