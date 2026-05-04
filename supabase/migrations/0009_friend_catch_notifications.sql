-- ============================================================
-- Carp Log v2.6 — friend notifications on personal catches
--
-- BEFORE: log_catch_activity (0004) returned early for catches with
-- trip_id IS NULL, so personal catches produced zero notifications.
--
-- AFTER:
--   - Trip catches: keep ALL existing behaviour — trip_activity
--     entries (lost_fish / caught / became_leader) AND trip_new_catch
--     notifications to other trip members.
--   - Personal catches (trip_id IS NULL, not lost): notify every
--     accepted friend with type 'trip_new_catch'. (Same enum value;
--     frontend already handles the trip-less render.)
--
-- Friend-on-trip dedup: members already get the trip-member path; the
-- branches are mutually exclusive on trip_id, so no double-notify.
--
-- Payload now also carries angler_name + species so the in-app row
-- can render the headline without a profile round-trip.
-- ============================================================

create or replace function public.log_catch_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  current_top_oz int;
  this_oz int;
  v_angler_name text;
begin
  select coalesce(display_name, username) into v_angler_name
    from public.profiles where id = new.angler_id;

  if new.trip_id is not null then
    if new.lost then
      insert into public.trip_activity (trip_id, angler_id, type, payload)
      values (new.trip_id, new.angler_id, 'lost_fish',
              jsonb_build_object('catch_id', new.id, 'rig', new.rig, 'swim', new.swim));
    else
      insert into public.trip_activity (trip_id, angler_id, type, payload)
      values (new.trip_id, new.angler_id, 'caught',
              jsonb_build_object('catch_id', new.id, 'lbs', new.lbs, 'oz', new.oz, 'species', new.species));

      this_oz := (new.lbs * 16) + new.oz;
      select coalesce(max((c.lbs * 16) + c.oz), 0) into current_top_oz
        from public.catches c
        where c.trip_id = new.trip_id and not c.lost and c.id <> new.id;
      if this_oz > current_top_oz and this_oz > 0 then
        insert into public.trip_activity (trip_id, angler_id, type, payload)
        values (new.trip_id, new.angler_id, 'became_leader',
                jsonb_build_object('catch_id', new.id, 'lbs', new.lbs, 'oz', new.oz, 'previous_top_oz', current_top_oz));
      end if;

      insert into public.notifications (recipient_id, type, payload)
      select tm.angler_id, 'trip_new_catch',
             jsonb_build_object(
               'trip_id', new.trip_id,
               'catch_id', new.id,
               'angler_id', new.angler_id,
               'angler_name', v_angler_name,
               'species', new.species,
               'lbs', new.lbs,
               'oz', new.oz
             )
      from public.trip_members tm
      where tm.trip_id = new.trip_id
        and tm.status = 'joined'
        and tm.angler_id <> new.angler_id;
    end if;
  else
    if not new.lost then
      insert into public.notifications (recipient_id, type, payload)
      select case
               when f.requester_id = new.angler_id then f.addressee_id
               else f.requester_id
             end,
             'trip_new_catch',
             jsonb_build_object(
               'trip_id', null,
               'catch_id', new.id,
               'angler_id', new.angler_id,
               'angler_name', v_angler_name,
               'species', new.species,
               'lbs', new.lbs,
               'oz', new.oz
             )
      from public.friendships f
      where f.status = 'accepted'
        and (f.requester_id = new.angler_id or f.addressee_id = new.angler_id);
    end if;
  end if;
  return new;
end $$;

-- Trigger from 0004 already binds to this function name; CREATE OR
-- REPLACE FUNCTION above is sufficient. No trigger DDL needed.
