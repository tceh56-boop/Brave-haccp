-- ЦЕХ — рецептура как в Шеф Эксперте: подзаголовки (разделы с отдельным выходом, выход блюда через «/»),
-- номер и дата рецептуры, выход полуфабриката. Подзаголовок — строка без сырья: в списание, производство и ТУ не идёт.

alter table ttk_lines add column kind text not null default 'item' check (kind in ('item', 'heading'));
alter table ttk_lines alter column unit drop not null;
alter table ttk_lines add constraint ttk_lines_heading_check check (
  (kind = 'item' and unit is not null) or (kind = 'heading' and unit is null and product_id is null and sub_dish_id is null and brutto is null and netto is null and ready is null));

alter table dishes add column card_no text;                -- номер рецептуры (ТТК № …); по умолчанию — по порядку
alter table ttk_versions add column card_date date default current_date;      -- дата рецептуры в документах; по умолчанию — дата создания версии
alter table ttk_versions add column semi_yield_g numeric check (semi_yield_g is null or semi_yield_g >= 0);   -- выход п/ф, г

-- номера уже созданных блюд — по порядку создания
update dishes d set card_no = x.n::text from (select id, row_number() over (partition by organization_id order by created_at, id) as n from dishes) x where x.id = d.id;
-- дата рецептуры уже созданных версий — дата создания (защиту снимаем только на этот перенос)
alter table ttk_versions disable trigger ttk_versions_guard;
update ttk_versions set card_date = created_at::date;
alter table ttk_versions enable trigger ttk_versions_guard;

-- утверждённая версия: дата рецептуры и выход п/ф тоже не меняются
create or replace function ttk_version_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Версия ТТК не удаляется'; end if;
  if old.status = 'archived' then raise exception 'Архивная версия ТТК не изменяется'; end if;
  if old.status = 'approved' and (new.status <> 'archived' or new.technology is distinct from old.technology or new.yield_g is distinct from old.yield_g
      or new.portion_g is distinct from old.portion_g or new.storage_conditions is distinct from old.storage_conditions or new.shelf_life is distinct from old.shelf_life
      or new.card_date is distinct from old.card_date or new.semi_yield_g is distinct from old.semi_yield_g) then
    raise exception 'Утверждённая ТТК не изменяется — создайте новую версию';
  end if;
  return new;
end $$;
