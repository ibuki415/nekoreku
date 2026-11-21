-- ネコレク クラウド用スキーマ（Supabase の SQL Editor に全部貼って Run するだけ）
-- 何度実行しても壊れないように「if not exists」「drop ... if exists」「create or replace」を使っています。

-- =========================================================
-- 1. テーブル
-- =========================================================

-- プロフィール（表示名）。auth.users と 1 対 1
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  created_at timestamptz not null default now()
);

-- 猫カード。画像本体は Storage、ここには保存パスだけ持つ
create table if not exists public.cats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  image_path text not null,
  background_style text not null,
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  place_name text not null default '場所不明',
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  caught_at timestamptz not null,
  collect_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists cats_lat_lng_idx on public.cats (lat, lng);
create index if not exists cats_country_code_idx on public.cats (country_code);
create index if not exists cats_owner_id_idx on public.cats (owner_id);

-- コレクト（他人の猫を集めた記録）
create table if not exists public.collections (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cat_id uuid not null references public.cats (id) on delete cascade,
  collected_at timestamptz not null default now(),
  primary key (user_id, cat_id)
);

create index if not exists collections_cat_id_idx on public.collections (cat_id);

-- =========================================================
-- 2. トリガー
-- =========================================================

-- 新規ユーザーが作られたら、プロフィールを自動で作る
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, 'ねこ好き#' || substr(new.id::text, 1, 4))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- すでに登録済みのユーザーにもプロフィールを作っておく（再実行しても安全）
insert into public.profiles (id, display_name)
select u.id, 'ねこ好き#' || substr(u.id::text, 1, 4)
from auth.users u
on conflict (id) do nothing;

-- cats の保存前処理：
--  ・位置を小数第2位（約1km）に丸める（クライアントでも丸めるが、DB側で強制する）
--  ・collect_count は直接いじれないようにする（pg_trigger_depth() が 2 以上＝
--    collections のトリガー経由の更新だけが変えられる）
--  ・owner_id の付け替えも禁止
create or replace function public.cats_before_write()
returns trigger
language plpgsql
as $$
begin
  if new.lat is not null then
    new.lat := round(new.lat::numeric, 2)::double precision;
  end if;
  if new.lng is not null then
    new.lng := round(new.lng::numeric, 2)::double precision;
  end if;

  if tg_op = 'INSERT' then
    new.collect_count := 0;
  elsif tg_op = 'UPDATE' then
    new.owner_id := old.owner_id;
    if pg_trigger_depth() < 2 then
      new.collect_count := old.collect_count;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists cats_before_write on public.cats;
create trigger cats_before_write
  before insert or update on public.cats
  for each row execute function public.cats_before_write();

-- collections の増減に合わせて cats.collect_count を更新する。
-- 他人の cats 行は RLS で更新できないので security definer で実行する
create or replace function public.update_collect_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.cats set collect_count = collect_count + 1 where id = new.cat_id;
  elsif tg_op = 'DELETE' then
    update public.cats set collect_count = greatest(collect_count - 1, 0) where id = old.cat_id;
  end if;
  return null;
end;
$$;

drop trigger if exists collections_count on public.collections;
create trigger collections_count
  after insert or delete on public.collections
  for each row execute function public.update_collect_count();

-- =========================================================
-- 3. RLS（行レベルセキュリティ）
-- =========================================================

alter table public.profiles enable row level security;
alter table public.cats enable row level security;
alter table public.collections enable row level security;

-- profiles：ログイン中なら誰でも読める。変更・作成は本人だけ
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- cats：ログイン中なら誰でも読める。作成・更新・削除は持ち主だけ
drop policy if exists "cats_select" on public.cats;
create policy "cats_select" on public.cats
  for select to authenticated using (true);

drop policy if exists "cats_insert_own" on public.cats;
create policy "cats_insert_own" on public.cats
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "cats_update_own" on public.cats;
create policy "cats_update_own" on public.cats
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "cats_delete_own" on public.cats;
create policy "cats_delete_own" on public.cats
  for delete to authenticated using (owner_id = auth.uid());

-- collections：自分の行だけ読める・消せる。追加は「自分の猫以外」だけ
drop policy if exists "collections_select_own" on public.collections;
create policy "collections_select_own" on public.collections
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "collections_insert_own" on public.collections;
create policy "collections_insert_own" on public.collections
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (
      select 1 from public.cats c where c.id = cat_id and c.owner_id = auth.uid()
    )
  );

drop policy if exists "collections_delete_own" on public.collections;
create policy "collections_delete_own" on public.collections
  for delete to authenticated using (user_id = auth.uid());

-- =========================================================
-- 4. 国ごとの件数（ズームアウト時の数字バブル用）
-- =========================================================

create or replace function public.country_counts()
returns table (country_code text, cat_count bigint, lat double precision, lng double precision)
language sql
stable
security invoker
set search_path = public
as $$
  select c.country_code, count(*)::bigint, avg(c.lat), avg(c.lng)
  from public.cats c
  where c.country_code is not null and c.lat is not null and c.lng is not null
  group by c.country_code;
$$;

grant execute on function public.country_counts() to authenticated;

-- =========================================================
-- 5. Storage（猫のステッカー画像）
-- =========================================================

-- 公開バケット（画像URLを知っていれば誰でも見られる）。PNGのみ・2MBまで
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cat-stickers', 'cat-stickers', true, 2097152, array['image/png'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 読む：このバケットなら誰でも
drop policy if exists "cat_stickers_read" on storage.objects;
create policy "cat_stickers_read" on storage.objects
  for select to public using (bucket_id = 'cat-stickers');

-- 書く・消す：自分の uid フォルダ（<uid>/<catId>.png）の中だけ
drop policy if exists "cat_stickers_insert_own" on storage.objects;
create policy "cat_stickers_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cat-stickers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "cat_stickers_update_own" on storage.objects;
create policy "cat_stickers_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'cat-stickers' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'cat-stickers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "cat_stickers_delete_own" on storage.objects;
create policy "cat_stickers_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'cat-stickers' and (storage.foldername(name))[1] = auth.uid()::text);
