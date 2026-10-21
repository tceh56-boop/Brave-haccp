-- ЦЕХ — этап 8: индексы по итогам нагрузочной проверки.
-- Журналы J01/J25/J42 для каждого замера проверяют, исправлен ли он, и ищут отклонение по объекту:
-- без индексов это полный перебор на каждую строку (530 мс на журнал за день при 300 замерах).
create index measurements_corrects_idx on measurements(corrects_id) where corrects_id is not null;
create index journal_entries_corrects_idx on journal_entries(corrects_id) where corrects_id is not null;
create index incidents_entity_idx on incidents(entity_id, kind, created_at) where entity_id is not null;
create index measurements_site_time_idx on measurements(organization_id, site_id, measured_at);
create index tasks_entity_idx on tasks(entity_type, entity_id) where entity_id is not null;
create index sales_order_line_idx on sales(order_line_id) where order_line_id is not null;
