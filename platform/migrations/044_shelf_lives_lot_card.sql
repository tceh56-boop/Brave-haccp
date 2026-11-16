-- ЦЕХ — ТЗ доработки 5.2 (разделение сроков в ТТК) и 6.2 (карточка / этикетка партии).
-- Сроки ТТК раздельно, в часах, с одним обязательным основанием: срок хранения (при условиях хранения), срок реализации
-- (готовой продукции с момента окончания технологического процесса), срок партии п/ф (уже был: shelf_life_hours),
-- срок после вскрытия упаковки. Текст shelf_life остаётся формулировкой для печатных документов.

alter table ttk_versions add column storage_hours numeric check (storage_hours is null or storage_hours > 0);
alter table ttk_versions add column sale_hours    numeric check (sale_hours is null or sale_hours > 0);
alter table ttk_versions add column opened_hours  numeric check (opened_hours is null or opened_hours > 0);
alter table ttk_versions add column shelf_basis   text;

-- Приёмка: изготовитель, ВСД (ФГИС «Меркурий», если применимо), условия хранения по маркировке.
alter table receipt_lines add column manufacturer text;
alter table receipt_lines add column vsd_no text;
alter table receipt_lines add column storage_conditions text;

-- Партия: условия хранения — снимок на момент создания (из приёмки или из ТТК).
alter table lots add column storage_conditions text;
