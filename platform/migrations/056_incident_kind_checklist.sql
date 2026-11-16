-- Отклонение из чек-листа: фактическое измерение вне предела (мастер-промт, раздел 7).
alter table incidents drop constraint incidents_kind_check;
alter table incidents add constraint incidents_kind_check check (kind in ('temperature_deviation', 'receipt_problem', 'expired_lot', 'reported', 'release_check', 'lab_fail', 'equipment', 'sanitation', 'checklist'));
