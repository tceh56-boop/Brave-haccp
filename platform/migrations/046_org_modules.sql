-- ТЗ 3.0 §1.4, §12.6: «ЦЕХ» — не кассовая система. Необязательные модули включаются настройкой организации;
-- по умолчанию выключены. Выключение не удаляет историю: прежние смены, заказы и продажи остаются в отчётах.
alter table organizations add column modules text[] not null default '{}';
alter table organizations add constraint organizations_modules_check check (modules <@ array['pos']::text[]);
