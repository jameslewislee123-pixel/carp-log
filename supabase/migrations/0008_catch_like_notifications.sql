-- ============================================================
-- Carp Log v2.5 — catch_liked notifications
--
-- When someone inserts a catch_likes row, fire a notification to the
-- catch's angler (unless the liker IS the angler — own-likes don't
-- notify yourself). Mirrors the existing trip_chat / comment-on-catch
-- trigger pattern: SECURITY DEFINER so the recipient_id insert isn't
-- blocked by the notifications RLS policy.
-- ============================================================

create or replace function public.notify_catch_liked() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_recipient uuid;
begin
  select angler_id into v_recipient from public.catches where id = new.catch_id;
  if v_recipient is null or v_recipient = new.angler_id then
    return new;
  end if;
  insert into public.notifications (recipient_id, type, payload)
  values (
    v_recipient,
    'catch_liked',
    jsonb_build_object(
      'catch_id', new.catch_id,
      'angler_id', new.angler_id
    )
  );
  return new;
end $$;

drop trigger if exists catch_likes_after_insert_notify on public.catch_likes;
create trigger catch_likes_after_insert_notify
  after insert on public.catch_likes
  for each row execute function public.notify_catch_liked();
