-- ЦЕХ — целостность утверждённых документов (ТЗ доработки, 11.3): у снимка — content_hash (SHA-256 канонического
-- jsonb-текста) и версия генератора. Хеш считает база при вставке; при чтении и экспорте снимок сверяется с хешем,
-- расхождение — событие безопасности и отказ выдать документ как достоверный.

create function snapshot_hash(j jsonb) returns text language sql immutable as $$ select encode(sha256(convert_to(j::text, 'UTF8')), 'hex') $$;
create function set_content_hash() returns trigger language plpgsql as $$
begin
  new.content_hash := snapshot_hash(new.snapshot);
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['ppk_versions', 'tech_spec_versions', 'sto_versions', 'ti_versions'] loop
    execute format('alter table %I add column content_hash text', t);
    execute format('alter table %I add column generator_version text not null default %L', t, 'ceh-2026.10');
    -- существующие снимки: хеш по текущему содержимому (триггер неизменяемости на время заполнения снят)
    execute format('alter table %I disable trigger user', t);
    execute format('update %I set content_hash = snapshot_hash(snapshot)', t);
    execute format('alter table %I enable trigger user', t);
    execute format('alter table %I alter column content_hash set not null', t);
    execute format('create trigger %I before insert on %I for each row execute function set_content_hash()', t || '_hash', t);
  end loop;
end $$;
