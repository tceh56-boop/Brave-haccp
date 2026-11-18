-- Финансовый контур, этап Ф-2: накладная полностью.
-- Решение владельца: режимы налогообложения — АУСН или патент (ПСН); оба — без НДС к вычету, поэтому себестоимость
-- товара — полная цена с НДС поставщика. Ставки НДС в коде не задаются: берутся из документа поставщика.

-- режим налогообложения предприятия (выбирает владелец); пусто — не указан
alter table organizations add column tax_regime text check (tax_regime in ('ausn_income', 'ausn_income_expense', 'psn'));
-- как обычно указаны цены в накладных поставщиков — значение по умолчанию для новой приёмки
alter table organizations add column invoice_prices_with_vat boolean not null default true;

-- отсрочка оплаты поставщику, дней (из договора поставки); пусто — оплата в день документа
alter table suppliers add column payment_days integer check (payment_days is null or payment_days between 0 and 365);

alter table receipts
  add column prices_with_vat     boolean not null default true,       -- цены строк в документе указаны с НДС
  add column doc_total           numeric check (doc_total is null or doc_total >= 0),          -- «Всего к оплате» по документу
  add column extra_costs         numeric not null default 0 check (extra_costs >= 0),           -- доставка, тара и т. п. по этому документу
  add column extra_costs_note    text,
  add column total_mismatch_reason text,                              -- почему сумма строк не сходится с итогом документа
  -- снимки при завершении (не меняются): сумма строк с НДС, НДС в том числе, к оплате, срок оплаты
  add column lines_total         numeric,
  add column vat_total           numeric,
  add column payable             numeric,                             -- null — не определить (есть принятые строки без цены)
  add column due_date            date,
  add constraint receipts_extra_costs_note check (extra_costs = 0 or extra_costs_note is not null);

alter table receipt_lines
  add column doc_price numeric check (doc_price is null or doc_price >= 0),     -- цена за единицу как в документе
  add column vat_rate  numeric check (vat_rate is null or (vat_rate >= 0 and vat_rate <= 30));   -- ставка НДС по документу, %; пусто — «без НДС»

-- прежние строки: цена в документе = записанной цене, НДС не указан
update receipt_lines set doc_price = unit_price where unit_price is not null;
-- прежние завершённые приёмки: сумма строк и к оплате по записанным ценам (строка без цены — сумма не определена)
update receipts r set
  lines_total = x.total, vat_total = 0, payable = x.payable, due_date = coalesce(r.document_date, (r.completed_at at time zone o.timezone)::date)
from (select receipt_id,
        case when bool_and(unit_price is not null) then round(sum(quantity * unit_price), 2) end as total,
        case when bool_and(unit_price is not null or decision = 'rejected') then round(coalesce(sum(quantity * unit_price) filter (where decision <> 'rejected'), 0), 2) end as payable
      from receipt_lines group by receipt_id) x, organizations o
where x.receipt_id = r.id and o.id = r.organization_id and r.status <> 'draft';
