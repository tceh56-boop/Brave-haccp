-- ЦЕХ — профиль предприятия для применимости требований встроенной нормативной библиотеки (src/server/norms):
-- число посадочных мест (СанПиН 2.3/2.4.4282-26, пп. 29, 34 — исключения для менее 25 мест) и особенности
-- деятельности (фритюр, реализация вне предприятия, соцобслуживание, питание детей).

alter table org_regulatory_profiles add column seats integer check (seats is null or seats >= 0);
alter table org_regulatory_profiles add column features text[] not null default '{}';
