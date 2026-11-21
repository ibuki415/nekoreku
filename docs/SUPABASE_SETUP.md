# Supabase（クラウド）の設定手順

ネコレク のクラウド機能（合言葉で参加・みんなの猫を地図で見る・コレクト）を使うための設定です。
**設定しなくてもアプリは動きます**（猫がこの端末の中だけに保存される「端末内モード」）。
所要時間は 15 分ほど。無料プランで足ります。

## 1. プロジェクトを作る

1. https://supabase.com を開き、「Start your project」からサインアップ（GitHub アカウントでも可）。
2. ログイン後、「New project」を押す。
3. 次を入れて「Create new project」を押す。
   - **Name**: `nekoreku` など好きな名前
   - **Database Password**: 自動生成のままで OK（どこかにメモ。普段は使いません）
   - **Region**: `Northeast Asia (Tokyo)`
4. 数分待つと、ダッシュボードが開きます。

## 2. テーブルなどを作る（SQL を実行）

1. 左メニューの **SQL Editor** を開く。
2. 「New query」を押す。
3. このリポジトリの `supabase/schema.sql` を開き、**中身を全部コピー**して貼り付ける。
4. 右下の **Run** を押す。「Success. No rows returned」と出れば成功です。
   - 何度実行しても壊れない作りなので、エラーが出たらそのまま再実行して大丈夫です。
5. 左メニューの **Table Editor** に `profiles` / `cats` / `collections` が、**Storage** に `cat-stickers` が増えていれば OK。

## 3. 「匿名ログイン」をオンにする

ネコレク はメールアドレスを使わず、**みんな共通の合言葉** で参加する仕組みです。
裏では「名無しのアカウント（匿名ログイン）」を自動で作り、合言葉が合った人だけを参加者にします。

1. 左メニューの **Authentication** → **Sign In / Providers** を開く。
2. **Allow anonymous sign-ins**（匿名サインインを許可）を **オン** にして **Save**。

## 4. 合言葉を決める

1. **SQL Editor** →「New query」を開き、次を貼る。`ここに合言葉` の部分だけ書き換えて **Run**。

   ```sql
   insert into public.app_settings (id, passphrase_hash)
   values (1, extensions.crypt('ここに合言葉', extensions.gen_salt('bf')))
   on conflict (id) do update set passphrase_hash = excluded.passphrase_hash;
   ```

2. 「Success」と出れば設定完了。合言葉は元に戻せない形（ハッシュ）でしか保存されません。
   - **合言葉はこのリポジトリのファイルには絶対に書かないでください**（GitHub で公開されています）。
   - 推測されにくいものにしてください（8文字以上・単語を2〜3個つなぐなど）。まちがいが全体で15分に20回を超えると、しばらく受け付けなくなります。
   - 変えたいときは同じ SQL を新しい合言葉で実行するだけ。**すでに参加している人はそのまま使えます**（入り直しは不要）。

## 5. キーを Vercel（と PC）に入れる

1. 左メニュー下の **Project Settings**（歯車）→ **API Keys** / **Data API** を開き、次の 2 つを確認する。
   - **Project URL**（`https://xxxxxxxx.supabase.co`）
   - **Publishable key**（`sb_publishable_` で始まる）または **anon public** キー。`secret` / `service_role` は **絶対に使わない**
2. **Vercel**: プロジェクト → **Settings** → **Environment Variables** に次の 2 つを追加して Save。
   その後 **Deployments** → 一番上の「⋯」→ **Redeploy**（キーは組み立て時に埋め込まれるため）。

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://あなたのプロジェクト.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=コピーしたキー
   ```

3. **PC で開発するとき（任意）**: `.env.local.example` を `.env.local` という名前でコピーし、同じ 2 行を書いて `npm run dev` を再起動。
   `.env.local` は Git に入らない設定になっています。

## 6. 動作確認

1. アプリの **マイページ** を開く。「合言葉で参加」の入力欄が出ていれば設定成功（出ないときは「クラウド機能は未設定です」）。
2. 合言葉を入れて「参加する」。表示名を好きな名前に変える。
3. 猫を撮ると、クラウドにも自動で保存されます。すでに撮ってある猫は「端末内の猫をクラウドに保存」で送れます。
4. 友達には **アプリの URL と合言葉** を伝えるだけ。地図にみんなの猫が出て、コレクトできます。

### 気をつけること
- アカウントは **その端末（そのブラウザ）の中だけ** にあります。Safari のデータ削除・機種変更・「参加をやめる」をすると、同じアカウントには戻れません（端末内の猫は残ります）。
- ホーム画面に追加したアプリと Safari は別扱いです。**ホーム画面のアプリの中で** 参加してください。

## うまくいかないとき

| 症状 | 確認すること |
|---|---|
| 「未設定です」のまま | Vercel の環境変数の名前の綴り、追加後に Redeploy したか（PC は `.env.local` と dev の再起動） |
| 「匿名ログインがオフ」と出る | 手順 3 の Allow anonymous sign-ins |
| 「合言葉がまだ設定されていません」 | 手順 4 の SQL を実行したか |
| 「合言葉が違います」 | 大文字・小文字・全角／半角・前後の空白 |
| 猫の保存に失敗する | 手順 2 の SQL が最後まで成功したか。Storage に `cat-stickers` があるか |

## 補足：プライバシーについて

- 撮影場所の**正確な座標は端末の中だけ**に保存されます。クラウドには小数第 2 位（約 1 km 四方）に丸めた値だけが送られ、サーバー側でも丸めて保存します。
- 猫の画像は公開バケットに置かれるため、画像の URL を知っている人は見られます。
- クラウドの猫は、合言葉で参加した人なら誰でも一覧・閲覧できます。参加していない人には見えません（画像ファイル自体は、URL を知っていれば見られます）。
