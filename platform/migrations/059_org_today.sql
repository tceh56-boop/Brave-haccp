-- Этап 0 промта доработки: «сегодня» и границы суток — только в часовом поясе организации.
create function org_today(org uuid) returns date language sql stable security definer set search_path = public as
$$ select (now() at time zone coalesce(timezone, 'Europe/Moscow'))::date from organizations where id = org $$;
grant execute on function org_today(uuid) to ceh_app;
-- день события (timestamptz) в часовом поясе организации
create function org_day(org uuid, ts timestamptz) returns date language sql stable security definer set search_path = public as
$$ select (ts at time zone coalesce(timezone, 'Europe/Moscow'))::date from organizations where id = org $$;
grant execute on function org_day(uuid, timestamptz) to ceh_app;
