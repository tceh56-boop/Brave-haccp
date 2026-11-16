-- ТЗ 3.0 §10.3, §9.3, §13.4; мастер-промт, этап 1: классы потерь, баланс партии, экономика партии.
-- Класс потерь — детерминированная функция вида движения и причины (история движений неизменяема и не переписывается):
--  technological — технологические потери по факту; sanitary — порча, несоответствие, брак, отзыв (риск для безопасности);
--  emergency — повреждение (аварийные); commercial — истечение срока (управление запасом);
--  unexplained — «другое», недостача по инвентаризации — требует объяснения.
create function loss_class(kind text, reason_code text, quantity numeric) returns text language sql immutable as $$
  select case
    when kind = 'write_off' then case reason_code
      when 'production_loss' then 'technological'
      when 'spoiled' then 'sanitary' when 'quality' then 'sanitary' when 'quarantine_reject' then 'sanitary' when 'recall' then 'sanitary'
      when 'damaged' then 'emergency' when 'expired' then 'commercial' else 'unexplained' end
    when kind = 'count_adjust' and quantity < 0 then 'unexplained'
    else null end
$$;
grant execute on function loss_class(text, text, numeric) to ceh_app;

-- снимок расчёта себестоимости партии выпуска: формула, входные партии, количества, цены, метод и версия
alter table lots add column cost_basis jsonb;
