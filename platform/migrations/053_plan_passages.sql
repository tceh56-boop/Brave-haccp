-- Мастер-промт, раздел 4: проверка проходов. Минимальную ширину прохода задаёт специалист с основанием
-- (норматив, проект, инструкция оборудования); система её не придумывает. Без значения проверка не выполняется.
alter table floor_plans add column min_passage_mm integer check (min_passage_mm is null or min_passage_mm between 300 and 5000);
alter table floor_plans add column min_passage_basis text;
alter table floor_plans add constraint floor_plans_passage_basis check (min_passage_mm is null or length(trim(min_passage_basis)) >= 5);
