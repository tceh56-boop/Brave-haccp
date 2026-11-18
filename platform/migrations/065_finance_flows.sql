-- Финансовый контур, этап Ф-1: честный P&L.
--  1) Движения склада за период и запас на любую дату считаются по журналу движений — индекс по времени в организации.
--  2) Мероприятия — канал продаж: проведённые мероприятия получают строки продаж (источник «event»), чтобы выручка и
--     себестоимость попали в P&L и отчёты. Для мероприятий, проведённых до этой миграции, строки восстанавливаются из
--     фактических порций и себестоимости позиций (то, что уже записано при проведении; ничего не досчитывается).
create index if not exists stock_movements_org_time_idx on stock_movements(organization_id, created_at);

insert into sales (organization_id, site_id, source, external_id, dish_id, name, qty, price, amount, sold_at, fulfil_status, cost, fulfilled_at, created_by)
select e.organization_id, e.site_id, 'event', e.id::text || ':' || i.dish_id::text, i.dish_id, d.name, i.actual_portions,
       coalesce(i.price, d.sale_price, 0), round(coalesce(i.price, d.sale_price, 0) * i.actual_portions, 2),
       ((e.event_date + time '12:00') at time zone o.timezone), 'done', i.cost, e.completed_at, e.completed_by
from plan_events e
join plan_event_items i on i.event_id = e.id
join dishes d on d.id = i.dish_id
join organizations o on o.id = e.organization_id
where e.status = 'done' and i.actual_portions > 0
on conflict (organization_id, source, external_id) do nothing;
