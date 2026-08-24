-- 로컬 검증 전용 — hd-project10 (운영 실행 금지)
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin','authenticator'))
     or exists (select 1 from pg_namespace where nspname='graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다.';
  end if;
end;
$guard$;

do $t$ begin raise notice '[프로젝트] 파일명 규칙 · 덮어쓰기 방지 · 브랜드 사전'; end $t$;

do $t$
declare v_j bigint; v_r boolean;
begin
  -- 대문자 L 은 품번에 정상적으로 쓰이므로 변환 대상이 아니다(소문자 l 만 1 로 본다).
  -- README 예시 31LM-10310 이 그대로 나와야 맞다.
  perform public._assert_eq(public.normalize_part_no('3ILM-IO3IO'), '31LM-10310',
    '혼동 문자(I·O)만 숫자로 되돌리고 대문자 L 은 그대로 둔다');
  perform public._assert_eq(public.normalize_part_no('S1B'), '518', 'S→5, B→8');
  perform public._assert(public.normalize_part_no('  ') is null, '공백만 있으면 null');

  perform public._assert_eq(public.resolve_brand('HYUNDRI'), 'HYUNDAI', '사전이 오독을 바로잡는다');
  perform public._assert_eq(public.resolve_brand('hyundai'), 'HYUNDAI', '소문자도 맞춘다');
  perform public._assert_eq(public.resolve_brand('KOMATSU'), 'KOMATSU', '사전에 없으면 대문자만 맞춰 돌려준다');
  perform public._assert(public.resolve_brand('') is null, '빈 값은 null');

  insert into public.job (label, engine, photo_count) values ('테스트작업','ocr', 3) returning id into v_j;

  insert into public.rename_item (job_id, seq, original_name, part_no, brand, confidence)
  values (v_j, 1, 'IMG_001.JPG', '31LM-10310', 'HYUNDAI', 0.95);

  -- 최종 파일명은 저장이 아니라 규칙으로 만들어진다
  perform public._assert_eq(
    (select new_name from public.rename_item where job_id=v_j and seq=1),
    '001_31LM-10310_(HYUNDAI).JPG', '파일명 규칙대로 만들어진다');

  -- 품번을 고치면 파일명이 따라온다 — 따로 저장했다면 옛 값이 남는다
  update public.rename_item set part_no = '31LM-99999' where job_id=v_j and seq=1;
  perform public._assert_eq(
    (select new_name from public.rename_item where job_id=v_j and seq=1),
    '001_31LM-99999_(HYUNDAI).JPG', '품번을 고치면 파일명이 자동으로 따라온다');

  -- 값이 없으면 UNKNOWN 으로 드러난다 (빈 이름으로 나가면 파일이 사라진 것처럼 보인다)
  insert into public.rename_item (job_id, seq, original_name) values (v_j, 2, 'IMG_002.JPG');
  perform public._assert_eq(
    (select new_name from public.rename_item where job_id=v_j and seq=2),
    '002_UNKNOWN_(UNKNOWN).JPG', '값이 비면 UNKNOWN 으로 드러난다');

  -- ★ 같은 파일명이 두 번 나오면 파일이 덮어써진다. 되돌릴 수 없는 사고다.
  v_r := false;
  begin
    insert into public.rename_item (job_id, seq, original_name, part_no, brand)
    values (v_j, 1, 'IMG_003.JPG', '31LM-99999', 'HYUNDAI');
  exception when unique_violation then v_r := true;
  end;
  perform public._assert(v_r, '같은 연번은 UNIQUE 가 막는다');

  v_r := false;
  begin
    -- 연번은 다르지만 결과 파일명이 같아지는 경우는 없다(연번이 이름에 들어가므로).
    -- 대신 같은 원본 파일이 두 번 들어오는 것을 막는다.
    insert into public.rename_item (job_id, seq, original_name, part_no, brand)
    values (v_j, 3, 'IMG_001.JPG', '31LM-10310', 'HYUNDAI');
  exception when unique_violation then v_r := true;
  end;
  perform public._assert(v_r, '같은 원본 파일이 두 번 들어오면 막는다');

  -- 검수 대기
  perform public._assert_eq((select count(*) from public.review_queue where job_id=v_j), 1::bigint,
    '값이 빈 행이 검수 대기에 잡힌다');

  insert into public.rename_item (job_id, seq, original_name, part_no, brand, confidence)
  values (v_j, 4, 'IMG_004.JPG', '31LM-10311', 'HYUNDAI', 0.42);
  perform public._assert_eq((select count(*) from public.review_queue where job_id=v_j), 2::bigint,
    '확신이 낮은 행도 검수 대기에 잡힌다');

  update public.rename_item set confirmed = true where job_id=v_j and seq=4;
  perform public._assert_eq((select count(*) from public.review_queue where job_id=v_j), 1::bigint,
    '검수를 마치면 대기에서 빠진다');

  -- seq 2 는 확신도가 아예 없다(null). 판독을 못 한 것이므로 저확신으로 세는 것이 맞다.
  perform public._assert_eq((select low_confidence_items from public.job_view where id=v_j), 1::bigint,
    '검수한 행은 저확신 집계에서 빠지고, 판독 못 한 행은 남는다');
  perform public._assert_eq((select unknown_items from public.job_view where id=v_j), 1::bigint,
    '값이 빈 행 수가 작업 요약에 잡힌다');

  -- 적용 시각 동기화
  update public.job set applied = true where id=v_j;
  perform public._assert((select applied_at from public.job where id=v_j) is not null,
    '적용하면 적용 시각이 채워진다');
  update public.job set applied = false where id=v_j;
  perform public._assert((select applied_at from public.job where id=v_j) is null,
    '되돌리면 적용 시각도 지워진다');

  v_r := false;
  begin
    insert into public.job (label, engine) values ('X','gemini');
  exception when check_violation then v_r := true;
  end;
  perform public._assert(v_r, '정의되지 않은 판독 엔진은 check 제약이 막는다');

  v_r := false;
  begin
    insert into public.rename_item (job_id, seq, original_name, confidence)
    values (v_j, 9, 'IMG_009.JPG', 1.5);
  exception when check_violation then v_r := true;
  end;
  perform public._assert(v_r, '확신도 1 초과는 check 제약이 막는다');

  -- 같은 표기가 두 브랜드로 등록되면 판독이 갈린다
  v_r := false;
  begin
    insert into public.brand (canonical, alias) values ('DOOSAN','HYUNDRI');
  exception when unique_violation then v_r := true;
  end;
  perform public._assert(v_r, '같은 표기를 두 브랜드에 등록할 수 없다');

  delete from public.job where id=v_j;
  perform public._assert_eq((select count(*) from public.rename_item where job_id=v_j), 0::bigint,
    '작업을 지우면 파일 행도 함께 지워진다');
end $t$;

do $t$ begin
  perform public._assert((select count(*) from public.brand) >= 9, '브랜드 사전 시드가 들어 있다');
end $t$;

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
