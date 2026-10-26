-- Additive SCMS receiver. Apply to KarateTech's Supabase database after backup.
-- All API writes use this transaction; competition-owned fields are preserved.
BEGIN;
CREATE TABLE IF NOT EXISTS public.kt_scms_participant_links (
  scms_participant_id text NOT NULL,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  karate_participant_id uuid NOT NULL REFERENCES public.participants(id),
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scms_participant_id, tournament_id),
  UNIQUE (karate_participant_id)
);
CREATE TABLE IF NOT EXISTS public.kt_scms_club_links (
  scms_club_id text PRIMARY KEY,
  karate_club_id uuid NOT NULL REFERENCES public.clubs(id)
);
ALTER TABLE public.kt_scms_participant_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kt_scms_club_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kt_scms_participant_links, public.kt_scms_club_links FROM anon, authenticated;
GRANT ALL ON public.kt_scms_participant_links, public.kt_scms_club_links TO service_role;

CREATE OR REPLACE FUNCTION public.kt_receive_scms_participant(payload jsonb, target_tournament uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  source_id text := btrim(payload->>'scms_participant_id');
  source_club text := coalesce(payload->>'scms_club_id', payload->>'club_id');
  participant_id uuid;
  target_club uuid;
  duplicate_id uuid;
  result_status text := 'UPDATED';
BEGIN
  IF source_id IS NULL OR source_id = '' OR nullif(btrim(payload->>'full_name'),'') IS NULL
     OR coalesce(payload->>'gender','') NOT IN ('Male','Female')
     OR nullif(btrim(payload->>'passport_ic'),'') IS NULL
     OR upper(btrim(payload->>'passport_ic')) IN ('N/A','NA')
     OR (payload->>'dob')::date > current_date
     OR coalesce((payload->>'weight')::numeric,0) <= 0
     OR coalesce((payload->>'height')::numeric,0) <= 0 THEN
    RAISE EXCEPTION 'Invalid participant';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tournaments WHERE id = target_tournament AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Receiver tournament is not available';
  END IF;
  -- Serialize writes within this destination tournament, including retries.
  PERFORM pg_advisory_xact_lock(hashtextextended('kt-scms:' || target_tournament::text, 0));
  SELECT karate_participant_id INTO participant_id FROM kt_scms_participant_links
    WHERE scms_participant_id = source_id AND tournament_id = target_tournament;
  IF participant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM participants WHERE id = participant_id AND deleted_at IS NULL AND tournament_id = target_tournament
  ) THEN
    RETURN jsonb_build_object('success',false,'status','SUSPECTED_DUPLICATE','scms_participant_id',source_id,'error','Existing athlete mapping requires administrator review.');
  END IF;
  SELECT id INTO duplicate_id FROM participants
    WHERE tournament_id = target_tournament AND deleted_at IS NULL
      AND (participant_id IS NULL OR id <> participant_id)
      AND (regexp_replace(upper(passport_ic), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(payload->>'passport_ic'), '[^A-Z0-9]', '', 'g')
        OR (lower(btrim(full_name)) = lower(btrim(payload->>'full_name')) AND dob = (payload->>'dob')::date AND gender = payload->>'gender'))
    LIMIT 1;
  IF duplicate_id IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'status','SUSPECTED_DUPLICATE','scms_participant_id',source_id,'error','An athlete with matching identity already exists in this tournament. Administrator review is required.');
  END IF;
  IF source_club IS NOT NULL AND nullif(btrim(payload->>'club_name'),'') IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('kt-scms-club:' || source_club, 0));
    SELECT karate_club_id INTO target_club FROM kt_scms_club_links WHERE scms_club_id = source_club;
    IF target_club IS NULL THEN
      INSERT INTO clubs(name) VALUES (btrim(payload->>'club_name'))
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO target_club;
      INSERT INTO kt_scms_club_links VALUES (source_club, target_club);
    END IF;
  END IF;
  IF participant_id IS NULL THEN
    participant_id := gen_random_uuid();
    result_status := 'CREATED';
    INSERT INTO participants(id,tournament_id,registration_no,full_name,gender,dob,passport_ic,weight,height,status)
      VALUES(participant_id,target_tournament,'SCMS-' || md5(source_id || ':' || target_tournament::text),
        btrim(payload->>'full_name'),payload->>'gender',(payload->>'dob')::date,
        btrim(payload->>'passport_ic'),(payload->>'weight')::numeric,(payload->>'height')::numeric,'Pending');
    INSERT INTO kt_scms_participant_links(scms_participant_id,tournament_id,karate_participant_id)
      VALUES(source_id,target_tournament,participant_id);
  END IF;
  UPDATE participants SET
    full_name = btrim(payload->>'full_name'), gender = payload->>'gender', dob = (payload->>'dob')::date,
    passport_ic = btrim(payload->>'passport_ic'), weight = (payload->>'weight')::numeric, height = (payload->>'height')::numeric,
    email = payload->>'email', phone = payload->>'phone', club_id = coalesce(target_club,club_id),
    emergency_contact_name = payload->>'emergency_contact_name', emergency_contact_phone = payload->>'emergency_contact_phone',
    nationality_code = coalesce(nullif(payload->>'nationality_code',''),nationality_code)
    WHERE id = participant_id;
  UPDATE kt_scms_participant_links SET last_synced_at = now()
    WHERE scms_participant_id = source_id AND tournament_id = target_tournament;
  RETURN jsonb_build_object('success',true,'status',result_status,'scms_participant_id',source_id,'karate_participant_id',participant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.kt_receive_scms_participant(jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kt_receive_scms_participant(jsonb,uuid) TO service_role;
COMMIT;
