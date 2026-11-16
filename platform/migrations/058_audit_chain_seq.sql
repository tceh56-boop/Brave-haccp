-- Этап 0 промта доработки: порядок цепочки аудита. id (bigserial) выдаётся до блокировки, поэтому параллельные
-- транзакции вставали в цепочку не в порядке id и проверка по id давала ложные разрывы. Теперь номер в цепочке
-- (chain_seq) и prev_hash назначаются под advisory-блокировкой организации; проверка идёт по chain_seq.
-- Старые записи не переписываются (история неизменяема): у них chain_seq пуст, они проверяются по связке prev_hash → hash.
alter table audit_events add column chain_seq bigint;
create unique index audit_chain_seq_idx on audit_events (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), chain_seq) where chain_seq is not null;

create or replace function audit_events_chain() returns trigger language plpgsql security definer
set search_path = public as $$
declare last text; seq bigint;
begin
  perform pg_advisory_xact_lock(hashtext('audit:' || coalesce(new.organization_id::text, 'platform')));
  select hash, chain_seq into last, seq from audit_events
   where organization_id is not distinct from new.organization_id and chain_seq is not null order by chain_seq desc limit 1;
  if last is null then
    -- первая запись по новой схеме: продолжаем хвост старой цепочки (запись, на которую никто не ссылается)
    select e.hash into last from audit_events e
     where e.organization_id is not distinct from new.organization_id
       and not exists (select 1 from audit_events x where x.organization_id is not distinct from e.organization_id and x.prev_hash = e.hash)
     order by e.id desc limit 1;
    seq := 0;
  end if;
  new.chain_seq := seq + 1;
  new.prev_hash := coalesce(last, 'GENESIS');
  new.created_at := clock_timestamp();
  new.hash := encode(sha256(convert_to(audit_chain_payload(new), 'UTF8')), 'hex');
  return new;
end $$;
