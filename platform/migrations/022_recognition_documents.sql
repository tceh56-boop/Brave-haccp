-- Этап 17, часть 2: распознанные документы и словарь соответствий (перенос MON CHEF V11/V12: OCR_ALIASES,
-- OCR_DOCUMENT_DEDUPE). Распознанный документ — черновик: в приёмку строки переносит человек, с проверками.
-- Соответствие «строка документа → товар» запоминается только когда товар выбрал или подтвердил человек.

create table recognition_documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  site_id         uuid not null references sites(id),
  receipt_id      uuid references receipts(id),
  kind            text not null check (kind in ('torg12', 'upd', 'fiscal_qr', 'banquet')),
  doc_key         text not null,                    -- ключ для поиска дублей (тип, поставщик, номер, дата, итог, строки)
  duplicate_of    uuid references recognition_documents(id),
  result          jsonb not null,
  files           integer not null check (files > 0),
  pages           integer not null default 0,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now()
);
create index recognition_documents_key_idx on recognition_documents(organization_id, doc_key);
create index recognition_documents_receipt_idx on recognition_documents(receipt_id);

create table recognition_aliases (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  supplier_key    text not null default '',          -- пусто — для всех поставщиков
  raw_text        text not null,
  raw_norm        text not null,
  product_id      uuid not null references products(id),
  hits            integer not null default 1,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, supplier_key, raw_norm)
);

do $$
declare t text;
begin
  foreach t in array array['recognition_documents', 'recognition_aliases'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to ceh_app using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id))', t || '_tenant', t);
  end loop;
end $$;

grant select, insert on recognition_documents to ceh_app;
grant select, insert, update on recognition_aliases to ceh_app;
