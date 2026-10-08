-- Preserve one-use encrypted-request IDs across rate-limit minute boundaries.
create or replace function public.google_drive_broker_rate_limit(p_bucket_key text, p_max_requests integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare count_now integer; nonce_inserted boolean;
begin
  if length(p_bucket_key) > 128 or p_max_requests < 1 or p_max_requests > 300 then return false; end if;
  delete from public.google_drive_broker_limits where window_start < now() - interval '10 minutes';
  -- Replay IDs must not reset at minute boundaries. Retain consumed IDs longer
  -- than the encrypted request's full acceptance window, including clock skew.
  if left(p_bucket_key, 7) = 'replay:' then
    if p_max_requests <> 1 then return false; end if;
    insert into public.google_drive_broker_limits (bucket_key, window_start, requests)
      values (p_bucket_key, now(), 1)
      on conflict (bucket_key) do nothing returning true into nonce_inserted;
    return coalesce(nonce_inserted, false);
  end if;
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
