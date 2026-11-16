-- ЦЕХ AI — агент по данным системы (развитие этапа 7 ТЗ v2, §11).
--
-- Агент сам запрашивает данные системы через инструменты (с правами пользователя), ищет требования в реестре
-- и отвечает в прежнем формате. Ход работы (какие данные запрошены и что вернулось) хранится в ai_jobs.context.шаги,
-- число обращений к модели — в ai_jobs.usage.turns. Правила прежние: только утверждённые источники, проверка цитат
-- и чисел, никаких действий без решения человека; журнал не изменяется.

alter table ai_jobs drop constraint ai_jobs_kind_check;
alter table ai_jobs add constraint ai_jobs_kind_check check (kind in ('incident_explain', 'question', 'capa_suggest', 'agent'));

alter table ai_jobs drop constraint ai_jobs_status_check;
alter table ai_jobs add constraint ai_jobs_status_check check (status in ('ok', 'guard_rejected', 'no_sources', 'unavailable', 'refused', 'error', 'step_limit'));
