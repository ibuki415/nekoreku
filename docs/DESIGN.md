# ネコレク 設計書（フェーズ2〜8）

街の猫を撮る → AIで猫だけ切り抜く → ギンガムチェック背景のステッカーカードにして集める PWA。
ユーザー（開発者）は初心者。**コード中のコメントは日本語で、要所に「何をしているか／なぜ」を短く書く。**
参考にした既存アプリの名前・ロゴ・デザインは真似しない。UI 文言はすべて日本語。

## 0. 前提・ルール

- Next.js **16.4**（App Router, `src/`、Turbopack）。**この版は従来と仕様が違う。ルーティング・動的ルート・`params`・`cacheComponents` 周りを書く前に `node_modules/next/dist/docs/01-app/` の該当ドキュメントを必ず読むこと。** `next.config.ts` は `cacheComponents: true`（外さない）。
- Tailwind v4（`globals.css` に色トークン: `finder`=#ffd400 黄, `detect`=#38bdf8 青, 背景 #0b0b0c）。
- ライブラリ（インストール済み）: `@mediapipe/tasks-vision@1.2.3`, `@imgly/background-removal@1.7.0`（AGPL, onnxruntime-web 1.21.0 同梱済）, `maplibre-gl@6.19`（ESM のみ。`dist/maplibre-gl.d.ts` で API を確認）, `idb@8`, `@supabase/supabase-js@2`。
- 開発サーバーは port 3029。**エージェントは dev サーバーを起動しない**（検証は設計者が行う）。完了条件は `npx tsc --noEmit`・`npm run lint`・`npm run build` がすべて通ること。
- カメラ・AI・地図・IndexedDB はブラウザ専用 → それらを使うコンポーネントは `"use client"`、重いライブラリは **`useEffect` 内やイベント内で `await import()`** する（サーバー側で評価されないように、初期 JS を軽くするため）。
- 既存: `src/app/layout.tsx`, `manifest.ts`, `apple-icon.tsx`, `src/components/EnvCheck.tsx`, `public/icon.svg`。

## 1. 画面構成とルート

| ルート | 内容 |
|---|---|
| `/` | `/camera` へリダイレクト |
| `/camera` | 撮影画面（全画面・黒基調） |
| `/collection` | 自分のコレクション一覧 |
| `/cat/[id]` | カード詳細（名前変更・削除・シェア/コレクト） |
| `/map` | 地図 |
| `/account` | （フェーズ7）ログイン・表示名・同期。動作環境チェック(EnvCheck)もここへ移す |

共通: 画面下部に固定タブバー `TabBar`（撮る／コレクション／地図／（フェーズ7以降）マイページ）。iPhone のホームバーに被らないよう `padding-bottom: env(safe-area-inset-bottom)`。撮影画面ではタブバーを半透明の黒にする。アイコンはインライン SVG（`src/components/icons.tsx` に集約）。絵文字は国旗以外使わない。

## 2. データモデル（ブラウザ内 IndexedDB）`src/lib/db.ts`

DB 名 `nekoreku`, version 1, store `cats`（keyPath `id`, index `caught_at`）。

```ts
export type CatRecord = {
  id: string;              // crypto.randomUUID()
  name: string;            // 1〜30文字。空なら「名無しの猫 #<通し番号>」
  sticker: Blob;           // 白フチ・影つき切り抜きPNG（背景透過）
  background_style: PatternId;
  lat: number | null;      // 端末内は正確な値。クラウドに送るときだけ丸める
  lng: number | null;
  place_name: string;      // 例「渋谷区 神南」。取れなければ「場所不明」
  country_code: string | null; // "JP" など大文字2文字
  caught_at: string;       // ISO文字列
  remote_id?: string | null; // フェーズ7: クラウドの cats.id（同期済みなら入る）
};
```
関数: `addCat`, `listCats()`（caught_at 降順）, `getCat(id)`, `updateCat(id, patch)`, `deleteCat(id)`, `countCats()`。
元写真は保存しない（容量とプライバシーのため）。Blob を表示するときは `useObjectUrl(blob)` フック（`URL.createObjectURL` → unmount で revoke）。

## 3. フェーズ2: カメラ画面 `src/app/camera/page.tsx` + `src/components/camera/*`

- `getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })`。`<video playsInline muted autoPlay>`（iPhone は playsInline 必須）を `object-cover` で全画面。
- マウント時に自動起動。失敗時（拒否・非HTTPS・カメラなし）は理由を日本語で表示し「もう一度試す」ボタンと「写真から選ぶ」を出す。ページ離脱時は `track.stop()`。
- オーバーレイ:
  - 中央に**黄色い四隅ブラケット**（正方形 `min(78vw, 60vh)`、線幅 5px、角丸、長さ 40px）。
  - 上部に文言「猫に向けてください」（白、軽い影）。
- 下部: 大きな丸いシャッターボタン（白リング）、左に「写真から選ぶ」（`<input type="file" accept="image/*">`）、右にコレクションの最新1枚のサムネ（なければ空）。

## 4. フェーズ3: 猫の検出 `src/lib/detector.ts`

- MediaPipe `ObjectDetector`。wasm は **`public/mediapipe-wasm/` にコピーして自前配信**（`node_modules/@mediapipe/tasks-vision/wasm/*` をコピーするスクリプト `scripts/copy-assets.mjs` を作り、`package.json` の `postinstall` と `predev`/`prebuild` で実行。コピー先は `.gitignore` しない＝コミットしてよい）。
  - `FilesetResolver.forVisionTasks("/mediapipe-wasm")`
  - モデル: `https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`
  - オプション: `categoryAllowlist: ["cat"]`, `scoreThreshold: 0.3`, `maxResults: 1`, `delegate: "GPU"`（作成失敗時は `"CPU"` で再試行）。
  - 動画用（`runningMode: "VIDEO"`）と静止画用（`"IMAGE"`）の2インスタンスをシングルトンで遅延生成。`getVideoDetector()`, `detectInImage(source)`。
- 検出ループ: `requestAnimationFrame` で回し、**約8fps に間引く**。`detectForVideo(video, performance.now())`（タイムスタンプは単調増加にすること）。
- 判定のちらつき防止: スコア ≥ 0.45 が **連続3回**で「発見」、**連続5回**外れたら「見失った」。
- 演出（発見中）:
  - ブラケットの色を青 `detect` に変え、`drop-shadow` で光らせ、ゆっくり脈打つ（CSS keyframes）。
  - 検出された bbox の位置に、**青く光る角丸の枠**（`box-shadow: 0 0 24px detect, inset 0 0 18px detect`）をなめらかに追従（CSS transition 120ms）。座標はビデオ実寸→画面表示座標へ `object-cover` の拡大・はみ出しを考慮して変換する（`src/lib/coverMap.ts` に純粋関数として切り出す）。
  - 文言を「猫を見つけた！ シャッターを押して」に変える。
- モデル読み込み中は小さく「AIを準備中…」。読み込み失敗時は検出なしでも撮影できる（文言「検出AIを読み込めませんでした。撮影はできます」）。

## 5. フェーズ4: 撮影 → 切り抜き → カード化

処理パイプライン `src/lib/pipeline.ts` の `processPhoto(source: Blob, onProgress)`:

1. 画像を `createImageBitmap` で読み込み（ファイル選択時は EXIF 回転を反映: `imageOrientation: "from-image"`）。長辺 2048px を超えたら縮小。
2. `detectInImage` で猫を探す。
   - **見つかった**: bbox を上下左右に 20% ずつ広げて（画像内に収める）切り出す → 切り抜きの精度が上がり、人や物が混ざりにくい。
   - **見つからない**: `{ status: "no-cat" }` を返す。UI は「猫が写っていないようです」と「撮り直す」「このまま切り抜く」（全体を使う）を出す。
3. 背景除去 `src/lib/cutout.ts`: `const { removeBackground } = await import("@imgly/background-removal")`、`{ model: "isnet_quint8", output: { format: "image/png" }, progress }`。`progress(key, current, total)` を「AIモデルをダウンロード中 xx%」に変換（初回のみ約40MB、2回目以降はブラウザのキャッシュ）。
4. 透明な余白をトリミング（alpha > 16 の外接矩形）→ 長辺 720px に収める。
5. ステッカー化 `src/lib/sticker.ts`: 白フチ（太さ = 長辺の 2.2%、最小 8px）を、**アルファ形状を円周 32 方向にずらして白で塗り重ねる**方法で作る → その下に柔らかい影（`shadowBlur` 18, `shadowOffsetY` 8, rgba(0,0,0,.28)）→ 一番上に元の切り抜き。余白を含めた PNG Blob を返す。
6. 位置情報は撮影ボタンを押した瞬間に並行して取得開始（`src/lib/geo.ts` の `getPosition(timeoutMs=10000)`、`enableHighAccuracy: true`、`maximumAge: 60000`）。失敗・拒否なら null。
7. 地名 `reverseGeocode(lat,lng)`: OSM Nominatim `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=..&lon=..&zoom=16&accept-language=ja`。`place_name` = `(city || town || village || county)` + 半角スペース + `(city_district || suburb || quarter || neighbourhood)`（空要素は除く）。`country_code` は大文字化。失敗時は「場所不明」/null。**1撮影につき1回しか呼ばない**（利用規約: 1秒1回まで）。

撮影フローの UI（カメラ画面上のオーバーレイシート `CaptureSheet`）:
- 処理中: 撮った写真をぼかして背景に、「切り抜き中…」＋進捗バー。初回は「AIモデルを準備中（初回のみ数十秒）」。
- 完成: `CatCard` プレビュー（ステッカーが「ぽんっ」と拡大して出るアニメーション）＋名前入力（placeholder「名前をつける（空でもOK）」）＋「コレクションに追加」「撮り直す」。チェック柄の背景はランダムに選ぶ。タップで背景柄を次の柄に変えられる。
- 追加 → `addCat` → `/cat/[id]` へ遷移。
- 撮影画面を開いたら、カメラが映った後にアイドル時間で `preload`（imgly の `preload`）を呼び、裏でモデルを温めておく。

チェック柄 `src/lib/patterns.ts`:
```ts
export const PATTERNS = [
  { id: "green-yellow", label: "グリーン×イエロー", a: "#5cb85c", b: "#ffe066" },
  { id: "pink-white",   label: "ピンク×ホワイト",   a: "#ff8fb1", b: "#ffffff" },
  { id: "blue-white",   label: "ブルー×ホワイト",   a: "#5aa9e6", b: "#ffffff" },
  { id: "orange-cream", label: "オレンジ×クリーム", a: "#ff9f43", b: "#fff4dc" },
  { id: "purple-mint",  label: "パープル×ミント",   a: "#a685e2", b: "#c8f7dc" },
  { id: "red-white",    label: "レッド×ホワイト",   a: "#ef5b5b", b: "#ffffff" },
] as const;
```
ギンガム = 地色 b の上に、半透明(色a, 55%)の縦縞と横縞を重ね、交点が濃くなる柄。セル幅 22px。CSS 版 `ginghamStyle(id): React.CSSProperties`（`repeating-linear-gradient` ×2）と、Canvas 版 `drawGingham(ctx, id, w, h, cell)`（フェーズ8のシェア画像用）を同じ定義から作る。

カード `src/components/CatCard.tsx`（オリジナルデザイン）:
- 縦長 3:4、角丸 28px、外側に薄い影。上 70% がチェック柄エリアでステッカー画像を中央に（`rotate(-4deg)`、max 82%）。
- 下 30% は白い情報パネル（文字は濃いグレー）: 1行目に猫の名前（太字・大）、2行目「〇〇がキャッチ」（ローカル時は「あなたがキャッチ」）、3行目にアイコン付きで「🕒相対時刻」「📍place_name」「👥 他N人が集めた」（N はフェーズ8まで非表示）。アイコンは SVG。
- 下部ボタン: `mode="own"` →「シェア」（フェーズ8で実装。それまでは非表示）、`mode="other"` →「コレクトする」。
- 相対時刻 `src/lib/time.ts`: 「たった今」(<1分)、「〇分前」「〇時間前」「〇日前」(<30日)、それ以降は `YYYY/M/D`。

## 6. フェーズ5: コレクション一覧 `/collection`

- ヘッダー「コレクション」＋「〇匹」。2列グリッドのミニカード（チェック柄＋ステッカー＋名前＋相対時刻）。新しい順。
- 空のとき: 「まだ猫がいません。街で猫を探しにいこう」＋「撮りに行く」ボタン。
- `/cat/[id]`: `CatCard` 大表示＋名前の変更（インライン編集）＋「削除」（確認ダイアログ「この猫をコレクションから削除しますか？元に戻せません」）＋「地図で見る」（`/map?focus=<id>`）。存在しない id は「見つかりませんでした」。

## 7. フェーズ6: 地図 `/map` `src/components/map/CatMap.tsx`

- MapLibre（`await import("maplibre-gl")` と `maplibre-gl/dist/maplibre-gl.css`）。スタイルは **OpenFreeMap**（無料・APIキー不要）`https://tiles.openfreemap.org/styles/liberty`。3D 風に `pitch: 50`。liberty スタイルに 3D 建物レイヤーが無ければ `fill-extrusion` レイヤーを追加（`render_height` を使用）。日本語ラベルにするため、文字ラベルの `text-field` を `["coalesce", ["get","name:ja"], ["get","name"]]` に差し替える。
- ピン: `maplibregl.Marker` の HTML 要素。直径 54px の丸に、ステッカー画像（白背景・object-contain）、**縁取り 4px の色で状態を表す**: Caught=青 `#2f7cf6`、Collected=オレンジ `#ff8a1f`、New to you=黒 `#111`。MVP は Caught のみ。
- ピンをタップ → 下からミニカード（名前・時刻・場所・「カードを見る」→ `/cat/[id]`）。
- 初期表示: `?focus=id` があればその猫へ zoom 16。なければ全猫が入るよう `fitBounds`（padding 60, maxZoom 16）。猫ゼロなら現在地（取れなければ東京駅 35.681, 139.767）に zoom 14。
- 右上に現在地ボタン（`GeolocateControl`）、左下に凡例（Caught／Collected／New to you の色丸。MVP は Caught のみ表示）。
- 地図の下端はタブバーの上で終わる。地図データの帰属表示（© OpenStreetMap 等）は消さない。

## 8. フェーズ7: クラウド化（Supabase）

**キー未設定でも動くこと**。`src/lib/supabase.ts` で `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` が両方あるときだけクライアントを作り、`isCloudEnabled` を export。無効時はフェーズ6までと同じ「端末内モード」で、マイページに「クラウド機能は未設定です（docs/SUPABASE_SETUP.md 参照）」と出す。`.env.local.example` を用意。

- ログイン: メールの **6桁コード**（`signInWithOtp({ email, options: { shouldCreateUser: true } })` → `verifyOtp({ email, token, type: "email" })`）。リンクではなくコード方式なのは、トンネル URL が毎回変わってもリダイレクト設定が不要なため。
- `/account`: 未ログイン→メール入力→コード入力。ログイン済み→表示名（profiles.display_name、初期値「ねこ好き#xxxx」）編集、同期状況、「端末内の猫をクラウドに保存（未同期 N 匹）」ボタン、ログアウト、EnvCheck。
- DB（`supabase/schema.sql` に全部書く。ユーザーが SQL Editor に貼って実行する）:
  - `profiles(id uuid pk references auth.users on delete cascade, display_name text not null check (char_length between 1 and 20), created_at timestamptz default now())` ＋ 新規ユーザー作成時に自動で行を作るトリガー。
  - `cats(id uuid pk default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users on delete cascade, name text not null check (char_length(name) between 1 and 30), image_path text not null, background_style text not null, lat double precision, lng double precision, place_name text not null default '場所不明', country_code text, caught_at timestamptz not null, collect_count int not null default 0, created_at timestamptz default now())`、`lat/lng` は **トリガーで小数第2位（約1km）に丸めて保存**（クライアントでも丸めるが、DB側でも強制する）。index (lat, lng), (country_code)。
  - `collections(user_id uuid default auth.uid() references auth.users on delete cascade, cat_id uuid references cats on delete cascade, collected_at timestamptz default now(), primary key (user_id, cat_id))`。insert/delete 時に `cats.collect_count` を増減する `security definer` トリガー。
  - RLS を全テーブルで有効化: cats は authenticated が select 可、insert/update/delete は `owner_id = auth.uid()`。profiles は authenticated が select 可、update は本人のみ。collections は本人の行のみ select/insert/delete、かつ自分の猫は collect 不可（insert の with check で `not exists (select 1 from cats where id = cat_id and owner_id = auth.uid())`）。
  - 関数 `country_counts()` returns table(country_code, cat_count, lat, lng)（国ごとの件数と平均座標、security invoker で OK）。
  - Storage バケット `cat-stickers`（public read）。ポリシー: authenticated は `(storage.foldername(name))[1] = auth.uid()::text` のパスにだけ insert/delete。パスは `<uid>/<catId>.png`。
- 同期方針（シンプルに）: 端末内(IndexedDB)が自分の猫の正本。ログイン中に新しく保存した猫は、保存直後に自動でクラウドへアップロード（画像→cats insert→`remote_id` 保存）。失敗しても端末内には残り、マイページから再送できる。名前変更・削除もクラウドに反映。別端末でログインしたときは、マイページの「クラウドから取り込む」でクラウドの自分の猫を IndexedDB に取り込める（sticker は画像をダウンロードして Blob 化）。
- `docs/SUPABASE_SETUP.md`: 初心者向けに、プロジェクト作成 → SQL 実行 → Auth の Email を有効化 → **メールテンプレート（Magic Link）に `{{ .Token }}` を入れる** → API キーを `.env.local` に書く → dev 再起動、を画面の項目名つきで説明。

## 9. フェーズ8: ソーシャル機能（クラウド有効時のみ。無効時は自分の猫だけで動く）

- 地図: 表示範囲（bounds）内のクラウドの猫を取得（`cats` を lat/lng の範囲で select、limit 300、`moveend` で再取得・200ms デバウンス）。色: 自分の猫=Caught 青、collections にある=Collected オレンジ、それ以外=New to you 黒。凡例も3つ表示。
- **ズームアウト（zoom < 5）**: ピンを隠し、国ごとの数字バブル（国旗絵文字＋数）を表示。国旗は country_code から地域指示子で生成（`String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))`）。クラウド有効時は `country_counts()`、無効時は端末内の猫を集計。バブルをタップでその地点へ zoom 6 にズームイン。zoom ≥ 5 でピンに戻る。
- 他人の猫のカード `/cat/[id]?src=cloud`: owner の表示名で「〇〇がキャッチ」、`collect_count` で「他N人が集めた」、ボタン「コレクトする」→ collections insert（済みなら「コレクト済み」＋解除）。
- コレクション画面にタブ「キャッチ（自分が撮った）」「コレクト（集めた）」。
- シェア: `src/lib/renderCard.ts` で Canvas にカード全体（チェック柄＋ステッカー＋白パネル＋文字）を 1080×1440 で描いて PNG 化 → `navigator.share({ files: [file], text })`（使えなければ画像をダウンロード）。自分の猫のカードの「シェア」ボタン。シェア画像に正確な位置は入れない（place_name のみ）。

## 10. 品質・その他

- すべての非同期処理に読み込み中／失敗の表示を日本語で。
- iPhone Safari 前提: `100dvh` を使う、`env(safe-area-inset-*)`、ボタンは 44px 以上。
- README の「開発フェーズ」を更新し、AGPL（imgly）の注意と OSM/Nominatim の利用規約に触れる。
