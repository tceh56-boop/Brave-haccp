-- Финансовый контур, этап Ф-3: долги и деньги (решение владельца: оплаты поставщикам и наличные кассы ведутся в ЦЕХ).
--  Записи о деньгах не изменяются и не удаляются: ошибочную аннулируют с причиной (как расходы, 031).

-- ───────── Оплаты поставщикам ─────────
create table supplier_payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid references sites(id),
  supplier_id     uuid not null references suppliers(id),
  kind            text not null default 'payment' check (kind in ('payment', 'refund')),   -- refund — поставщик вернул нам деньги
  paid_on         date not null,
  amount          numeric not null check (amount > 0),
  method          text not null check (method in ('bank', 'cash', 'cash_register', 'card')),
  doc_no          text,
  comment         text,
  source          text not null default 'manual' check (source in ('manual', 'bank')),
  bank_line_id    uuid,
  operation_id    text,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  voided_by       uuid references users(id),
  voided_at       timestamptz,
  void_reason     text,
  check ((voided_at is null) = (voided_by is null))
);
create index supplier_payments_idx on supplier_payments(organization_id, supplier_id, paid_on);
create unique index supplier_payments_op on supplier_payments(organization_id, operation_id) where operation_id is not null;

-- разнесение оплаты по накладным (FIFO по сроку оплаты или выбранные накладные)
create table supplier_payment_allocations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  payment_id      uuid not null references supplier_payments(id),
  receipt_id      uuid not null references receipts(id),
  amount          numeric not null check (amount > 0)
);
create index supplier_payment_alloc_receipt on supplier_payment_allocations(receipt_id);

-- уменьшение (или увеличение) долга без денег: возврат товара поставщику, корректировка (УКД)
create table supplier_credits (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  supplier_id     uuid not null references suppliers(id),
  receipt_id      uuid references receipts(id),
  kind            text not null check (kind in ('return', 'correction')),
  on_date         date not null,
  amount          numeric not null check (amount <> 0),     -- «+» — должны меньше, «−» — должны больше (корректировка в сторону увеличения)
  doc_no          text,
  reason          text not null,
  lot_id          uuid references lots(id),
  quantity        numeric,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  voided_by       uuid references users(id),
  voided_at       timestamptz,
  void_reason     text,
  check ((voided_at is null) = (voided_by is null)),
  check (kind = 'correction' or (lot_id is not null and quantity > 0 and amount > 0))
);
create index supplier_credits_idx on supplier_credits(organization_id, supplier_id);

-- ───────── Наличные в кассе ─────────
create table pos_cash_ops (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  shift_id        uuid not null references pos_shifts(id),
  kind            text not null check (kind in ('deposit', 'event_payment', 'withdrawal', 'collection', 'expense', 'supplier_payment')),
  amount          numeric not null check (amount > 0),
  reason          text not null,
  expense_id      uuid references expenses(id),
  supplier_payment_id uuid references supplier_payments(id),
  event_payment_id uuid,
  operation_id    text,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now()
);
create index pos_cash_ops_shift on pos_cash_ops(shift_id);
create unique index pos_cash_ops_op on pos_cash_ops(organization_id, operation_id) where operation_id is not null;
create trigger pos_cash_ops_no_update before update or delete on pos_cash_ops for each row execute function tech_data_immutable();

-- способ оплаты расхода (для ДДС и выдачи из кассы); пусто — не указан
alter table expenses add column payment_method text check (payment_method in ('bank', 'cash', 'cash_register', 'card'));
alter table expenses drop constraint expenses_category_check;
alter table expenses add constraint expenses_category_check check (category in ('payroll', 'rent', 'utilities', 'marketing', 'services', 'equipment', 'taxes', 'acquiring', 'delivery', 'other'));

-- ───────── Оплаты мероприятий (предоплата, доплата, возврат) ─────────
create table event_payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  event_id        uuid not null references plan_events(id),
  kind            text not null check (kind in ('prepayment', 'payment', 'refund')),
  paid_on         date not null,
  amount          numeric not null check (amount > 0),
  method          text not null check (method in ('bank', 'cash', 'cash_register', 'card')),
  doc_no          text,
  comment         text,
  source          text not null default 'manual' check (source in ('manual', 'bank')),
  bank_line_id    uuid,
  operation_id    text,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  voided_by       uuid references users(id),
  voided_at       timestamptz,
  void_reason     text,
  check ((voided_at is null) = (voided_by is null))
);
create index event_payments_idx on event_payments(organization_id, event_id);
create unique index event_payments_op on event_payments(organization_id, operation_id) where operation_id is not null;
alter table pos_cash_ops add constraint pos_cash_ops_event_payment_fk foreign key (event_payment_id) references event_payments(id);

-- ───────── Банковская выписка (формат обмена 1С «Клиент-Банк») ─────────
create table bank_statements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  account         text not null,
  date_from       date,
  date_to         date,
  file_hash       text not null,
  lines           integer not null,
  imported_by     uuid not null references users(id),
  created_at      timestamptz not null default now(),
  unique (organization_id, file_hash)
);
create table bank_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  statement_id    uuid not null references bank_statements(id),
  line_hash       text not null,
  doc_no          text,
  op_date         date not null,
  amount          numeric not null check (amount <> 0),        -- «+» поступление, «−» списание
  counterparty    text,
  counterparty_inn text,
  purpose         text,
  status          text not null default 'new' check (status in ('new', 'supplier_payment', 'expense', 'event_payment', 'acquiring', 'transfer', 'ignored')),
  note            text,
  supplier_payment_id uuid references supplier_payments(id),
  expense_id      uuid references expenses(id),
  event_payment_id uuid references event_payments(id),
  decided_by      uuid references users(id),
  decided_at      timestamptz,
  unique (organization_id, line_hash)
);
create index bank_lines_status on bank_lines(organization_id, status, op_date);
alter table supplier_payments add constraint supplier_payments_bank_fk foreign key (bank_line_id) references bank_lines(id);
alter table event_payments add constraint event_payments_bank_fk foreign key (bank_line_id) references bank_lines(id);

-- неизменяемость: деньги не правятся; разрешено только аннулирование (один раз, с причиной) и разнесение строки выписки
create function money_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Запись о деньгах не удаляется — аннулируйте с причиной'; end if;
  if old.voided_at is not null then raise exception 'Аннулированная запись не изменяется'; end if;
  if new.voided_at is null or new.void_reason is null then raise exception 'Запись о деньгах не изменяется — аннулируйте и внесите заново'; end if;
  if (to_jsonb(new) - array['voided_by', 'voided_at', 'void_reason']) is distinct from (to_jsonb(old) - array['voided_by', 'voided_at', 'void_reason']) then
    raise exception 'При аннулировании меняются только отметки аннулирования';
  end if;
  return new;
end $$;
create trigger supplier_payments_guard before update or delete on supplier_payments for each row execute function money_guard();
create trigger supplier_credits_guard before update or delete on supplier_credits for each row execute function money_guard();
create trigger event_payments_guard before update or delete on event_payments for each row execute function money_guard();
create trigger supplier_payment_alloc_no_update before update or delete on supplier_payment_allocations for each row execute function tech_data_immutable();
create trigger bank_statements_no_update before update or delete on bank_statements for each row execute function tech_data_immutable();

create function bank_line_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Строка выписки не удаляется'; end if;
  if (new.statement_id, new.line_hash, new.doc_no, new.op_date, new.amount, new.counterparty, new.counterparty_inn, new.purpose)
     is distinct from (old.statement_id, old.line_hash, old.doc_no, old.op_date, old.amount, old.counterparty, old.counterparty_inn, old.purpose) then
    raise exception 'Данные выписки не изменяются — меняется только разнесение';
  end if;
  return new;
end $$;
create trigger bank_lines_guard before update or delete on bank_lines for each row execute function bank_line_guard();

do $$
declare t text;
begin
  foreach t in array array['supplier_payments', 'supplier_payment_allocations', 'supplier_credits', 'pos_cash_ops', 'event_payments', 'bank_statements', 'bank_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;
grant select, insert, update on supplier_payments, supplier_credits, event_payments, bank_lines to ceh_app;
grant select, insert on supplier_payment_allocations, pos_cash_ops, bank_statements to ceh_app;
