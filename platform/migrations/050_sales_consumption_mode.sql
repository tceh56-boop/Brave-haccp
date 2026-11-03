-- Дефект Д-2 аудита; ТЗ 3.0 §12.5: расчётное потребление по продажам отделено от фактического расхода.
--  estimate      — продажа создаёт только расчётное потребление (consumption_estimates); склад меняют выпуск, расход,
--                  списание и инвентаризация. По умолчанию.
--  ttk_writeoff  — согласованная предприятием методика сверки: продажа списывает сырьё по ТТК (FEFO); движения
--                  помечены reason_code = 'ttk_writeoff' («расчётное списание»), расчёт пишется и в consumption_estimates.
alter table organizations add column sales_consumption text not null default 'estimate' check (sales_consumption in ('estimate', 'ttk_writeoff'));
alter table sales add column consumption_kind text check (consumption_kind in ('estimate', 'ttk_writeoff'));
-- продажи, списанные до разделения, — по прежней механике (списание по ТТК)
update sales set consumption_kind = 'ttk_writeoff' where fulfil_status = 'done';
