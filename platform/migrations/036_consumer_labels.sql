-- ЦЕХ — потребительская этикетка упакованной продукции собственного изготовления (ТР ТС 022/2011, ст. 4.1 п. 1).
-- Хранится в той же таблице этикеток (неизменяемый снимок, код для QR, журнал печати), вид — 'consumer'.
alter table labels drop constraint labels_kind_check;
alter table labels add constraint labels_kind_check check (kind in ('lot', 'opened', 'consumer'));
alter table label_prints drop constraint label_prints_format_check;
alter table label_prints add constraint label_prints_format_check check (format in ('58x40', '58x30', 'a4', '58x60', '100x70'));
