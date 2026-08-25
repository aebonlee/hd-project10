-- ============================================================================
-- hd-project10 — 부품 사진 파일명 자동화
-- Supabase(Postgres) 운영 스키마 + RLS · 재실행 안전
--
--  이 스키마는 **수강생 본인의 Supabase 프로젝트**에 올리는 것을 전제로 합니다.
--  프로젝트가 본인 것이라 테이블 이름에 접두사를 붙이지 않았습니다.
--
--  사진 자체는 DB 에 넣지 않습니다. 판독은 브라우저 안에서 끝나고,
--  여기 남는 것은 **브랜드 사전**과 **어떤 파일을 무엇으로 바꿨는가** 뿐입니다.
--  그래야 다음 사람이 같은 오독을 반복하지 않습니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

-- 브랜드 사전 — OCR 이 흔들리는 표기를 정답으로 모아 둔다
create table if not exists public.brand (
  id         bigint generated always as identity primary key,
  canonical  text not null,                       -- 'HYUNDAI'
  alias      text not null,                       -- 'HYUNDRI', 'HYUNDA1' …
  hits       int not null default 0,
  created_at timestamptz not null default now(),
  -- 같은 표기가 두 브랜드로 등록되면 판독이 갈린다
  constraint brand_alias_key unique (alias)
);
create index if not exists brand_canonical_idx on public.brand (canonical);

-- 작업 회차 — 폴더 하나를 처리할 때마다 한 행
create table if not exists public.job (
  id          bigint generated always as identity primary key,
  label       text not null,
  engine      text not null default 'ocr'
              check (engine in ('ocr','claude','chatgpt','solar','manual')),
  photo_count int not null default 0 check (photo_count >= 0),
  applied     boolean not null default false,
  applied_at  timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  constraint job_applied_consistency check (applied = (applied_at is not null))
);
create index if not exists job_created_idx on public.job (created_at desc);

-- 파일별 판독·검수 결과
create table if not exists public.rename_item (
  id            bigint generated always as identity primary key,
  job_id        bigint not null references public.job(id) on delete cascade,
  seq           int not null check (seq > 0),
  original_name text not null,
  part_no       text,
  brand         text,
  extension     text not null default 'JPG',
  -- 최종 파일명은 저장하지 않고 규칙으로 만든다.
  -- 따로 저장하면 품번을 고친 뒤 파일명이 옛 값으로 남는다.
  new_name      text generated always as (
                  lpad(seq::text, 3, '0') || '_' || coalesce(part_no, 'UNKNOWN')
                  || '_(' || coalesce(brand, 'UNKNOWN') || ').' || extension
                ) stored,
  confidence    numeric check (confidence between 0 and 1),
  confirmed     boolean not null default false,   -- 사람이 검수했는가
  note          text,
  constraint rename_seq_uniq unique (job_id, seq),
  -- ★ 같은 작업 안에서 최종 파일명이 겹치면 **파일이 덮어써진다.**
  --    되돌릴 수 없는 사고라 DB 가 직접 막는다.
  constraint rename_newname_uniq unique (job_id, new_name),
  constraint rename_original_uniq unique (job_id, original_name)
);
create index if not exists rename_job_idx on public.rename_item (job_id, seq);

create table if not exists public.log (
  id        bigint generated always as identity primary key,
  ran_at    timestamptz not null default now(),
  kind      text not null,
  job_id    bigint,
  detail    text,
  processed int not null default 0,
  failed    int not null default 0,
  actor     uuid default auth.uid()
);
create index if not exists log_ran_at_idx on public.log (ran_at desc);

create table if not exists public.admin (
  user_id uuid primary key, email text, created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. 함수
-- ----------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.admin a where a.user_id = auth.uid());
$fn$;

/**
 * 혼동 문자 보정 — OCR 이 자주 헷갈리는 글자를 품번 표기로 되돌린다.
 * 품번은 대문자·숫자·하이픈만 쓰므로 O/0, I/1, S/5 의 방향이 정해진다.
 */
create or replace function public.normalize_part_no(p_raw text)
returns text language sql immutable set search_path = public as $fn$
  select nullif(
    translate(upper(btrim(coalesce(p_raw, ''))), 'OIlSB', '01158'),
  '');
$fn$;

/** 사전을 거쳐 브랜드 표기를 정답으로 되돌린다. 없으면 대문자만 맞춰 돌려준다. */
create or replace function public.resolve_brand(p_raw text)
returns text language sql stable set search_path = public as $fn$
  select coalesce(
    (select b.canonical from public.brand b
      where b.alias = upper(btrim(coalesce(p_raw, ''))) limit 1),
    nullif(upper(btrim(coalesce(p_raw, ''))), ''));
$fn$;

create or replace function public.sync_job()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if new.applied and new.applied_at is null then new.applied_at := now(); end if;
  if not new.applied then new.applied_at := null; end if;
  return new;
end;
$fn$;

drop trigger if exists job_sync on public.job;
create trigger job_sync before insert or update on public.job
  for each row execute function public.sync_job();

-- ----------------------------------------------------------------------------
-- 3. 뷰
-- ----------------------------------------------------------------------------


-- ⚠ 뷰에는 `with (security_invoker = true)` 를 붙인다.
--   붙이지 않으면 뷰는 **만든 사람(postgres)의 권한**으로 돌아, 뷰를 읽을 수 있는
--   사람이 밑에 깔린 표의 RLS 를 통째로 지나친다. 표만 잠그고 뷰를 안 잠그면 헛일이다.
--   (hd-project03 에서 실제로 남의 업체 실사 결과가 뷰로 그대로 보였다.
--    tests/server.test.js 의 "업체는 보고서 뷰로도 남의 자료를 볼 수 없다" 가 잡는다)
--   security_invoker 는 PostgreSQL 15 부터. Supabase 는 15 이상이다.
create or replace view public.job_view with (security_invoker = true) as
select j.*,
       (select count(*) from public.rename_item r where r.job_id = j.id)                    as items,
       (select count(*) from public.rename_item r where r.job_id = j.id and r.confirmed)    as confirmed_items,
       (select count(*) from public.rename_item r where r.job_id = j.id
          and (r.part_no is null or r.brand is null))                                       as unknown_items,
       (select count(*) from public.rename_item r where r.job_id = j.id
          and coalesce(r.confidence, 0) < 0.7 and not r.confirmed)                          as low_confidence_items
from public.job j;

-- 사람이 봐야 하는 것 — 확신이 낮거나 값이 빈 행
create or replace view public.review_queue with (security_invoker = true) as
select r.*, j.label as job_label
from public.rename_item r
join public.job j on j.id = r.job_id
where not r.confirmed
  and (r.part_no is null or r.brand is null or coalesce(r.confidence, 0) < 0.7);

-- 검수하며 고친 브랜드 표기 — 사전에 넣을 후보
create or replace view public.brand_candidates with (security_invoker = true) as
select brand as canonical, count(*) as hits
from public.rename_item
where confirmed and brand is not null
  and not exists (select 1 from public.brand b where b.canonical = rename_item.brand)
group by brand;

-- ----------------------------------------------------------------------------
-- 4. RLS
-- ----------------------------------------------------------------------------

alter table public.brand       enable row level security;
alter table public.job         enable row level security;
alter table public.rename_item enable row level security;
alter table public.log         enable row level security;
alter table public.admin       enable row level security;

-- 브랜드 사전은 다 같이 쌓는다. 한 사람만 고칠 수 있으면 사전이 자라지 않는다.
drop policy if exists brand_read   on public.brand;
drop policy if exists brand_write  on public.brand;
drop policy if exists brand_update on public.brand;
drop policy if exists brand_delete on public.brand;
create policy brand_read   on public.brand for select to authenticated using (true);
create policy brand_write  on public.brand for insert to authenticated with check (true);
create policy brand_update on public.brand for update to authenticated using (true) with check (true);
create policy brand_delete on public.brand for delete to authenticated using (public.is_admin());

-- 작업은 본인 것만 고친다
drop policy if exists job_read   on public.job;
drop policy if exists job_write  on public.job;
drop policy if exists job_update on public.job;
drop policy if exists job_delete on public.job;
create policy job_read   on public.job for select to authenticated using (true);
create policy job_write  on public.job for insert to authenticated with check (true);
create policy job_update on public.job for update to authenticated
  using (public.is_admin() or created_by = auth.uid())
  with check (public.is_admin() or created_by = auth.uid());
create policy job_delete on public.job for delete to authenticated
  using (public.is_admin() or created_by = auth.uid());

drop policy if exists rename_item_read   on public.rename_item;
drop policy if exists rename_item_write  on public.rename_item;
drop policy if exists rename_item_update on public.rename_item;
drop policy if exists rename_item_delete on public.rename_item;
create policy rename_item_read   on public.rename_item for select to authenticated using (true);
create policy rename_item_write  on public.rename_item for insert to authenticated with check (true);
create policy rename_item_update on public.rename_item for update to authenticated using (true) with check (true);
create policy rename_item_delete on public.rename_item for delete to authenticated using (public.is_admin());

drop policy if exists log_read  on public.log;
drop policy if exists log_write on public.log;
create policy log_read  on public.log for select to authenticated using (true);
create policy log_write on public.log for insert to authenticated with check (true);

drop policy if exists admin_read on public.admin;
create policy admin_read on public.admin for select to authenticated using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 5. 함수 실행 권한 (§ Supabase 기본 권한 주의)
--
--  ⚠ GRANT 만으로는 제한되지 않습니다. 권한이 두 겹으로 미리 붙습니다.
--    ① Postgres 가 함수 생성 시 PUBLIC 에 EXECUTE 기본 부여
--    ② Supabase 가 ALTER DEFAULT PRIVILEGES 로 신규 함수마다
--       anon·authenticated·service_role 에 자동 부여
--    PUBLIC 만 지우면 anon=X 가 남아 비로그인 호출이 그대로 뚫립니다.
-- ----------------------------------------------------------------------------

revoke all on function public.is_admin()               from public, anon;
revoke all on function public.normalize_part_no(text)  from public, anon;
revoke all on function public.resolve_brand(text)      from public, anon;
revoke all on function public.sync_job()               from public, anon;

grant execute on function public.is_admin()              to authenticated;
grant execute on function public.normalize_part_no(text) to authenticated;
grant execute on function public.resolve_brand(text)     to authenticated;
grant execute on function public.sync_job()              to authenticated;

-- ----------------------------------------------------------------------------
-- 6. 시드 — 자주 나오는 브랜드 오독
-- ----------------------------------------------------------------------------

insert into public.brand (canonical, alias) values
  ('HYUNDAI','HYUNDAI'), ('HYUNDAI','HYUNDRI'), ('HYUNDAI','HYUNDA1'), ('HYUNDAI','HYUNOAI'),
  ('DEVELON','DEVELON'), ('DEVELON','DEVEL0N'), ('DEVELON','DEUELON'),
  ('DOOSAN','DOOSAN'),   ('DOOSAN','D00SAN')
on conflict (alias) do nothing;
