-- ЦЕХ — этап 8: доставка писем из очереди (подтверждение почты, приглашения, восстановление пароля).
-- Повторы с нарастающей паузой; после 6 неудач письмо остаётся в очереди с ошибкой для разбора.
alter table outbox_emails add column attempts integer not null default 0;
alter table outbox_emails add column next_attempt_at timestamptz not null default now();
create index outbox_pending_idx on outbox_emails(next_attempt_at) where sent_at is null;
