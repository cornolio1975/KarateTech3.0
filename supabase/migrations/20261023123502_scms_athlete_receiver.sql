-- SCMS v1 athlete intake. Server-only; existing participant UUIDs and tournament-owned fields stay stable.
create table if not exists public.scms_participant_mappings (
 id uuid primary key default gen_random_uuid(),scms_participant_id varchar(100) not null unique,
 karate_participant_id uuid not null references public.participants(id),source_system varchar(40) not null default 'SCMS',
 sync_status varchar(30) not null default 'synced',last_synced_at timestamptz default now(),
 created_at timestamptz default now(),updated_at timestamptz default now(),last_error text
);
create unique index if not exists scms_mapping_source_unique on public.scms_participant_mappings(scms_participant_id);
create index if not exists scms_mapping_participant_idx on public.scms_participant_mappings(karate_participant_id);
create table if not exists public.scms_club_mappings (
 scms_club_id uuid primary key,karate_club_id uuid not null unique references public.clubs(id)
);
create table if not exists public.scms_athlete_sources (
 scms_member_id uuid primary key,karate_participant_id uuid not null unique references public.participants(id),
 scms_club_id uuid not null references public.scms_club_mappings(scms_club_id),
 source_data jsonb not null,last_request_key text not null,updated_at timestamptz not null default now()
);
create index if not exists scms_source_club_idx on public.scms_athlete_sources(scms_club_id);
alter table public.scms_participant_mappings enable row level security;
alter table public.scms_club_mappings enable row level security;
alter table public.scms_athlete_sources enable row level security;
-- Sensitive mappings and snapshots are integration-server only. No browser policy is added.
revoke all on public.scms_participant_mappings,public.scms_club_mappings,public.scms_athlete_sources from public,anon,authenticated;
grant select,insert,update on public.scms_participant_mappings,public.scms_club_mappings,public.scms_athlete_sources to service_role;
grant select,insert,update on public.participants,public.clubs to service_role;

create or replace function public.scms_athlete_lookup(p_member uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select s.source_data || jsonb_build_object(
 'exists',true,'karatetech_participant_id',p.id,'participant_name',p.full_name,'gender',p.gender,
 'date_of_birth',p.dob::text,'email',p.email,'phone',p.phone,'passport_ic',p.passport_ic,
 'nationality_code',p.nationality_code,'weight',p.weight,'height',p.height,
 'emergency_contact_name',p.emergency_contact_name,'emergency_contact_phone',p.emergency_contact_phone,'club_name',c.name)
 from public.scms_athlete_sources s join public.participants p on p.id=s.karate_participant_id
 join public.clubs c on c.id=p.club_id where s.scms_member_id=p_member and p.deleted_at is null
$$;
revoke all on function public.scms_athlete_lookup(uuid) from public,anon,authenticated;
grant execute on function public.scms_athlete_lookup(uuid) to service_role;

create or replace function public.scms_athlete_upsert(p_payload jsonb,p_key text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 m uuid:=(p_payload->>'scms_member_id')::uuid;cid uuid:=(p_payload->>'scms_club_id')::uuid;
 kt uuid;kc uuid;existing public.participants;source public.scms_athlete_sources;
 nm text:=trim(p_payload->>'participant_name');birth date:=(p_payload->>'date_of_birth')::date;
 operation text;collision integer;
begin
 if current_user<>'service_role' then raise exception 'Integration server required' using errcode='42501';end if;
 if coalesce(p_payload->>'contract_version','')<>'1' or m is null or cid is null or length(nm)<1 or birth is null or birth>current_date or
    p_payload->>'gender' not in ('Male','Female') or coalesce(p_key,'') !~ '^SCMS-[a-f0-9]{64}$'
 then raise exception 'Invalid athlete contract' using errcode='22023';end if;
 -- One identity lock also serialises different source IDs trying to create the same athlete.
 perform pg_advisory_xact_lock(hashtextextended('scms-member:'||m::text,0));
 perform pg_advisory_xact_lock(hashtextextended('scms-identity:'||lower(regexp_replace(nm,'\s+',' ','g'))||birth::text,0));
 if nullif(trim(p_payload->>'passport_ic'),'') is not null then
 perform pg_advisory_xact_lock(hashtextextended('scms-ic:'||lower(trim(p_payload->>'passport_ic')),0));end if;
 select * into source from public.scms_athlete_sources where scms_member_id=m;
 if source.scms_member_id is not null and ((p_payload->>'source_revision')::timestamptz < (source.source_data->>'source_revision')::timestamptz or
 ((p_payload->>'source_revision')::timestamptz = (source.source_data->>'source_revision')::timestamptz and source.source_data<>p_payload)) then
 raise exception 'Stale or inconsistent source revision' using errcode='P0002';end if;
 select karate_participant_id into kt from public.scms_participant_mappings where scms_participant_id=m::text;
 if kt is not null then
  select * into existing from public.participants where id=kt for update;
  if not found or existing.deleted_at is not null then raise exception 'Mapped participant unavailable' using errcode='P0002';end if;
  if lower(regexp_replace(trim(existing.full_name),'\s+',' ','g'))<>lower(regexp_replace(nm,'\s+',' ','g')) or existing.dob<>birth then
   raise exception 'Identity conflict requires reconciliation' using errcode='P0002';end if;
  if source.scms_club_id is distinct from cid then raise exception 'Club reassignment requires reconciliation' using errcode='P0002';end if;
 end if;
 select count(*) into collision from public.participants p where p.deleted_at is null and p.id is distinct from kt and
 (lower(regexp_replace(trim(p.full_name),'\s+',' ','g'))=lower(regexp_replace(nm,'\s+',' ','g')) and p.dob=birth
 or nullif(trim(p_payload->>'passport_ic'),'') is not null and lower(trim(p.passport_ic))=lower(trim(p_payload->>'passport_ic')));
 if collision>0 then raise exception 'Existing athlete must be linked manually' using errcode='23505';end if;
 -- Mandatory participant-table fields must be real values; never invent measurements or IDs.
 if nullif(trim(p_payload->>'passport_ic'),'') is null or coalesce((p_payload->>'weight')::numeric,0)<=0 or coalesce((p_payload->>'height')::numeric,0)<=0 then
  raise exception 'Passport/IC, weight and height required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('scms-club:'||cid::text,0));
 select karate_club_id into kc from public.scms_club_mappings where scms_club_id=cid;
 if kc is null then
  if exists(select 1 from public.clubs where lower(trim(name))=lower(trim(p_payload->>'club_name'))) then
   raise exception 'Club mapping needs reconciliation' using errcode='P0002';end if;
  insert into public.clubs(name) values(trim(p_payload->>'club_name')) returning id into kc;
  insert into public.scms_club_mappings values(cid,kc);
 else
  update public.clubs set name=trim(p_payload->>'club_name') where id=kc;
 end if;
 if kt is null then
  kt:=gen_random_uuid();operation:='created';
  insert into public.participants(id,registration_no,full_name,gender,dob,passport_ic,weight,height,club_id)
  values(kt,'SCMS-'||m::text,nm,p_payload->>'gender',birth,p_payload->>'passport_ic',(p_payload->>'weight')::numeric,(p_payload->>'height')::numeric,kc);
 else
  operation:=case when (source.source_data-'source_revision')=(p_payload-'source_revision') and (public.scms_athlete_lookup(m)-'source_revision') @> (p_payload-'source_revision') then 'unchanged' else 'updated' end;
 end if;
 update public.participants set full_name=nm,gender=p_payload->>'gender',dob=birth,club_id=kc,
 passport_ic=p_payload->>'passport_ic',nationality_code=nullif(p_payload->>'nationality_code',''),email=p_payload->>'email',phone=p_payload->>'phone',
 weight=(p_payload->>'weight')::numeric,height=(p_payload->>'height')::numeric,
 emergency_contact_name=p_payload->>'emergency_contact_name',emergency_contact_phone=p_payload->>'emergency_contact_phone'
 where id=kt;
 insert into public.scms_participant_mappings(scms_participant_id,karate_participant_id,source_system,sync_status,last_synced_at)
 values(m::text,kt,'SCMS','synced',now()) on conflict(scms_participant_id) do update set sync_status='synced',last_synced_at=now(),updated_at=now(),last_error=null;
 insert into public.scms_athlete_sources(scms_member_id,karate_participant_id,scms_club_id,source_data,last_request_key)
 values(m,kt,cid,p_payload,p_key) on conflict(scms_member_id) do update set source_data=p_payload,last_request_key=p_key,updated_at=now();
 return jsonb_build_object('karatetech_participant_id',kt,'operation',operation);
end $$;
revoke all on function public.scms_athlete_upsert(jsonb,text) from public,anon,authenticated;
grant execute on function public.scms_athlete_upsert(jsonb,text) to service_role;
