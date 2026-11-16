-- Этап 1 доработки под кухню и ХАССП: ККТ из производства.
--  * Какие замеры нужны при выпуске, задают документы: этап ТТК ссылается на ККТ/ОПП плана ХАССП (код опасности,
--    стабилен между версиями плана), форма записи мониторинга (J22/J23/J24) задаёт вид замера.
--  * Предел замера при выпуске — запись release_checks, утверждаемая отдельно (haccp.approve). Нет утверждённого
--    предела — «не настроено», выпуск закрыт (fail-closed).
--  * Замер: вид (одиночный, начало/конец охлаждения), время замера отдельно от времени внесения, щуп из реестра
--    оборудования с действующей поверкой (снимок подписи), исправление — новой записью с причиной.

alter table release_checks
  add column kind        text not null default 'other' check (kind in ('core_temp', 'cooling', 'reheat', 'other')),
  add column ccp_code    text,                                   -- код опасности плана ХАССП (ККТ/ОПП), из мониторинга которой берётся форма и корректирующее действие
  add column max_minutes numeric check (max_minutes is null or max_minutes > 0),   -- охлаждение: допустимая длительность от начала до конца
  add column start_min   numeric,                                -- охлаждение: температура в начале не ниже
  add column approved_by uuid references users(id),
  add column approved_at timestamptz;

-- Действовавшие до этапа параметры вводились ответственным ХАССП и сразу применялись — считаются утверждёнными им.
update release_checks set approved_by = created_by, approved_at = created_at where status = 'active';

alter table release_checks drop constraint release_checks_status_check;
alter table release_checks add constraint release_checks_status_check check (status in ('draft', 'active', 'archived'));
alter table release_checks add constraint release_checks_approved check (status <> 'active' or approved_by is not null);
alter table release_checks add constraint release_checks_cooling check (kind <> 'cooling' or max_minutes is not null);
alter table release_checks alter column status set default 'draft';

alter table ttk_stages add column ccp_code text;              -- этап — ККТ/ОПП плана ХАССП: при выпуске нужен замер

alter table production_checks
  add column phase             text not null default 'single' check (phase in ('single', 'start', 'end')),
  add column measured_at       timestamptz not null default now(),
  add column value_before      numeric,                         -- температура до (тепловая обработка, разогрев)
  add column duration_min      numeric check (duration_min is null or duration_min >= 0),
  add column start_id          uuid references production_checks(id),
  add column instrument_id     uuid references equipment(id),
  add column instrument        text,                            -- снимок: прибор, номер, срок поверки
  add column corrects_id       uuid references production_checks(id),
  add column correction_reason text,
  add constraint production_checks_correction check (corrects_id is null or correction_reason is not null),
  add constraint production_checks_end_start check (phase <> 'end' or start_id is not null);
alter table production_checks disable trigger production_checks_no_update;
update production_checks set measured_at = recorded_at;   -- прежние замеры: время замера = время внесения
alter table production_checks enable trigger production_checks_no_update;
create index production_checks_measured_idx on production_checks(organization_id, measured_at);
