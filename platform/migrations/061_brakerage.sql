-- Этап 2 доработки под кухню и ХАССП: бракераж из выпуска блюда (J58; J02/J40 — из этих записей).
--  * Бракераж проводит только роль с правом brakerage.decide; повар выпускает партию, до решения она на удержании.
--  * Эталон органолептики — снимок из утверждённой ТТК на момент решения; ответ «соответствует / не соответствует + причина».
--  * Время разрешения к реализации и кто разрешил — отдельно от времени выпуска.
--  * Суточная проба при выпуске — для мероприятий и блюд, где это указано (dishes.sample_on_release).
alter table production_orders
  add column assessed_at     timestamptz,
  add column reject_reason   text,
  add column organoleptic_ref jsonb,
  add constraint production_orders_reject_reason check (release_decision is distinct from 'rejected' or reject_reason is not null or organoleptic is not null);
-- прежние решения (вносились при выпуске): время решения = время выпуска
update production_orders set assessed_at = completed_at where release_decision is not null and assessed_at is null;

alter table dishes add column sample_on_release boolean not null default false;

alter table incidents drop constraint incidents_kind_check;
alter table incidents add constraint incidents_kind_check check (kind in ('temperature_deviation', 'receipt_problem', 'expired_lot', 'reported', 'release_check', 'lab_fail', 'equipment', 'sanitation', 'checklist', 'brakerage'));
