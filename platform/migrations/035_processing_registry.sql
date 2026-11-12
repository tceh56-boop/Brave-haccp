-- ЦЕХ — реестр норм обработки сырья (общий для всех организаций): продукт / вид обработки / процент и все данные
-- источника. Первый источник — Сборник рецептур для обучающихся образовательных организаций (2022): таблица
-- «Расчет расхода сырья и выхода полуфабрикатов» (с. 669–671) и брутто/нетто/массы после обработки рецептур.
-- Загружается из data/reference/sbornik2022.json (npm run import:reference). Нормой предприятия строка становится
-- только после внесения и утверждения человеком (processing_norms).

create table reference_processing_norms (
  code          text primary key,                 -- T01… (таблица), R0001… (рецептуры)
  source_doc    text not null,                    -- издание
  product       text not null,                    -- как в источнике
  method_code   text not null references processing_methods(code),
  kind          text not null check (kind in ('cold', 'thermal')),
  pct           numeric not null,                 -- отходы / потери, % (основное значение; отрицательное — привар)
  pct_min       numeric not null,
  pct_max       numeric not null,
  brutto        numeric,                          -- на 100 г нетто (холодная)
  netto         numeric,
  after_mass    numeric,                          -- масса после тепловой обработки из 100 г
  season_from   integer, season_to integer, season_text text,
  source_kind   text not null check (source_kind in ('table', 'recipes', 'pf')),
  page          integer,
  recipes       integer[] not null default '{}',  -- номера рецептур основного значения
  recipes_total integer,
  variants      jsonb not null default '[]',      -- все встречающиеся значения с номерами рецептур
  note          text,
  basis         text not null,                    -- готовое основание для нормы предприятия
  base_products jsonb not null default '[]',      -- продукты справочника (code, name) по названию
  imported_at   timestamptz not null default now()
);
create index reference_processing_norms_product_idx on reference_processing_norms (lower(product));
grant select on reference_processing_norms to ceh_app;
