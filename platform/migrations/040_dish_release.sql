-- ЦЕХ — выпуск готовой продукции партией (ТЗ доработки, 7.5, журнал J58): бракераж при выпуске.
-- Органолептическая оценка и решение о допуске к реализации вносит человек; «не допущено» — партия в карантин.
alter table production_orders
  add column organoleptic text,
  add column release_decision text check (release_decision in ('allowed', 'rejected')),
  add column assessed_by uuid references users(id);
