-- Revision is controlled by a row trigger, including direct writes, imports and offline uploads.
alter table public.participants add column if not exists scms_revision bigint not null default 0;
create or replace function public.scms_participant_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.scms_revision:=old.scms_revision;
 if row(new.full_name,new.gender,new.dob,new.passport_ic,new.nationality_code,new.email,new.phone,new.weight,new.height,new.emergency_contact_name,new.emergency_contact_phone,new.club_id)
 is distinct from row(old.full_name,old.gender,old.dob,old.passport_ic,old.nationality_code,old.email,old.phone,old.weight,old.height,old.emergency_contact_name,old.emergency_contact_phone,old.club_id)
 then new.scms_revision:=old.scms_revision+1;end if;
 return new;
end $$;
revoke all on function public.scms_participant_revision() from public,anon,authenticated;
create trigger scms_participant_revision before update on public.participants
 for each row execute function public.scms_participant_revision();
create or replace function public.scms_athlete_lookup(p_member uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select s.source_data || jsonb_build_object(
 'exists',true,'karatetech_participant_id',p.id,'participant_name',p.full_name,'gender',p.gender,
 'date_of_birth',p.dob::text,'email',p.email,'phone',p.phone,'passport_ic',p.passport_ic,
 'nationality_code',p.nationality_code,'weight',p.weight,'height',p.height,
 'emergency_contact_name',p.emergency_contact_name,'emergency_contact_phone',p.emergency_contact_phone,'club_name',c.name,
 'source_snapshot',s.source_data,'karatetech_revision',p.scms_revision::text,
 'club_mapping_valid',p.club_id=cm.karate_club_id)
 from public.scms_athlete_sources s join public.participants p on p.id=s.karate_participant_id
 join public.clubs c on c.id=p.club_id join public.scms_club_mappings cm on cm.scms_club_id=s.scms_club_id
 where s.scms_member_id=p_member and p.deleted_at is null
$$;
revoke all on function public.scms_athlete_lookup(uuid) from public,anon,authenticated;
grant execute on function public.scms_athlete_lookup(uuid) to service_role;
