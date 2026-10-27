-- KarateTech database ONLY. Requires 20261027090000_scms_receiver.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS public.kt_scms_registration_receipts (
  idempotency_key text PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  scms_club_id text NOT NULL,
  selections jsonb NOT NULL,
  acknowledgement_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kt_scms_registration_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kt_scms_registration_receipts FROM anon,authenticated;
GRANT ALL ON public.kt_scms_registration_receipts TO service_role;
CREATE OR REPLACE FUNCTION public.kt_register_scms_draft(draft jsonb,target_tournament uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  receipt kt_scms_registration_receipts%ROWTYPE;
  event tournaments%ROWTYPE;
  athlete participants%ROWTYPE;
  category categories%ROWTYPE;
  item jsonb;
  choices jsonb;
  age_years integer;
  assigned integer;
  acknowledgement uuid;
BEGIN
  IF draft->>'tournamentId' IS DISTINCT FROM target_tournament::text THEN RAISE EXCEPTION 'WRONG_TOURNAMENT'; END IF;
  IF jsonb_typeof(draft->'participants') IS DISTINCT FROM 'array' OR nullif(btrim(draft->>'clubId'),'') IS NULL OR nullif(btrim(draft->>'idempotencyKey'),'') IS NULL THEN RAISE EXCEPTION 'INVALID_DRAFT'; END IF;
  IF jsonb_array_length(draft->'participants') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_DRAFT'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(draft->'participants') p WHERE nullif(p->>'scmsMemberId','') IS NULL OR coalesce(p->>'targetCategoryId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RAISE EXCEPTION 'INVALID_DRAFT'; END IF;
  SELECT jsonb_agg(jsonb_build_object('member',p->>'scmsMemberId','category',p->>'targetCategoryId') ORDER BY p->>'scmsMemberId',p->>'targetCategoryId') INTO choices FROM jsonb_array_elements(draft->'participants') p;
  IF (SELECT count(*) FROM (SELECT DISTINCT p->>'scmsMemberId',p->>'targetCategoryId' FROM jsonb_array_elements(draft->'participants') p) x) <> jsonb_array_length(choices) THEN RAISE EXCEPTION 'INVALID_DRAFT'; END IF;
  -- Serialize same-key retries across tournaments, then registration/intake within tournament.
  PERFORM pg_advisory_xact_lock(hashtextextended('kt-scms-receipt:'||(draft->>'idempotencyKey'),0));
  PERFORM pg_advisory_xact_lock(hashtextextended('kt-scms:'||target_tournament::text,0));
  SELECT * INTO receipt FROM kt_scms_registration_receipts WHERE idempotency_key=draft->>'idempotencyKey';
  IF FOUND THEN
    IF receipt.tournament_id<>target_tournament OR receipt.scms_club_id<>draft->>'clubId' OR receipt.selections<>choices THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN jsonb_build_object('success',true,'acknowledgementId','KT-REG-'||receipt.acknowledgement_id::text);
  END IF;
  SELECT * INTO event FROM tournaments WHERE id=target_tournament AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND OR coalesce(lower(event.status),'') NOT IN ('open','published') OR event.registration_close_iso IS NULL OR event.registration_close_iso<now() OR event.date_iso IS NULL THEN RAISE EXCEPTION 'REGISTRATION_CLOSED'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(choices) LOOP
    SELECT p.* INTO athlete FROM participants p JOIN kt_scms_participant_links l ON l.karate_participant_id=p.id
      JOIN kt_scms_club_links c ON c.karate_club_id=p.club_id
      WHERE l.scms_participant_id=item->>'member' AND l.tournament_id=target_tournament
        AND c.scms_club_id=draft->>'clubId' AND p.tournament_id=target_tournament AND p.deleted_at IS NULL FOR UPDATE OF p;
    IF NOT FOUND OR athlete.status IN ('Cancelled','Disqualified') THEN RAISE EXCEPTION 'ATHLETE_NOT_SYNCED'; END IF;
    SELECT * INTO category FROM categories WHERE id=(item->>'category')::uuid AND tournament_id=target_tournament FOR UPDATE;
    IF NOT FOUND OR coalesce(lower(category.status),'')<>'open' THEN RAISE EXCEPTION 'INVALID_CATEGORY'; END IF;
    age_years:=extract(year FROM age((event.date_iso AT TIME ZONE 'Asia/Kuala_Lumpur')::date,athlete.dob));
    IF athlete.dob IS NULL OR age_years NOT BETWEEN category.min_age AND category.max_age OR (category.gender<>'Mixed' AND category.gender<>athlete.gender)
      OR athlete.weight IS NULL OR athlete.weight<=0
      OR (lower(category.name) LIKE '%kumite%' AND athlete.weight NOT BETWEEN category.min_weight AND category.max_weight) THEN RAISE EXCEPTION 'NOT_ELIGIBLE'; END IF;
    IF NOT EXISTS(SELECT 1 FROM participant_categories WHERE participant_id=athlete.id AND category_id=category.id) THEN
      SELECT count(*) INTO assigned FROM participant_categories pc JOIN participants p ON p.id=pc.participant_id WHERE pc.category_id=category.id AND p.deleted_at IS NULL AND p.status<>'Cancelled';
      IF category.capacity IS NOT NULL AND assigned>=category.capacity THEN RAISE EXCEPTION 'CATEGORY_FULL'; END IF;
      INSERT INTO participant_categories(participant_id,category_id,tournament_id) VALUES(athlete.id,category.id,target_tournament) ON CONFLICT(participant_id,category_id) DO NOTHING;
    END IF;
  END LOOP;
  INSERT INTO kt_scms_registration_receipts(idempotency_key,tournament_id,scms_club_id,selections)
    VALUES(draft->>'idempotencyKey',target_tournament,draft->>'clubId',choices) RETURNING acknowledgement_id INTO acknowledgement;
  RETURN jsonb_build_object('success',true,'acknowledgementId','KT-REG-'||acknowledgement::text);
END;
$$;
REVOKE ALL ON FUNCTION public.kt_register_scms_draft(jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kt_register_scms_draft(jsonb,uuid) TO service_role;
COMMIT;
