-- Contains only hashed rate-limit identifiers/counters, never OAuth tokens.
create table if not exists public.google_drive_broker_limits (
  bucket_key text primary key,
  window_start timestamptz not null,
  requests integer not null
);
alter table public.google_drive_broker_limits enable row level security;
revoke all on public.google_drive_broker_limits from public, anon, authenticated;

create or replace function public.google_drive_broker_rate_limit(p_bucket_key text, p_max_requests integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare count_now integer;
begin
  if length(p_bucket_key) > 128 or p_max_requests < 1 or p_max_requests > 300 then return false; end if;
  delete from public.google_drive_broker_limits where window_start < now() - interval '10 minutes';
  insert into public.google_drive_broker_limits as limits (bucket_key, window_start, requests)
    values (p_bucket_key, date_trunc('minute', now()), 1)
    on conflict (bucket_key) do update set
      window_start = excluded.window_start,
      requests = case when limits.window_start = excluded.window_start then least(limits.requests + 1, p_max_requests + 1) else 1 end
    returning requests into count_now;
  return count_now <= p_max_requests;
end;
$$;
revoke all on function public.google_drive_broker_rate_limit(text, integer) from public, anon, authenticated;
grant execute on function public.google_drive_broker_rate_limit(text, integer) to service_role;
