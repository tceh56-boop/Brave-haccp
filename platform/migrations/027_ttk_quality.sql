-- ЦЕХ — показатели качества для ТТК по ГОСТ 31987-2012 и обоснования расчётов (как в Шеф Эксперте).
--  * Рецептура: органолептика (внешний вид, цвет, консистенция, вкус и запах), подача, описание для меню.
--  * Товар (по документу, вместе с пищевой ценностью): сухие вещества, сахароза, массовая доля жира — на 100 г.
--    Нет данных — показатель не рассчитывается, а не считается нулём.
--  * Нормируемые физико-химические показатели блюда (Гербер, соль, коэффициенты) — в параметрах блюда (tech_specs.params).

alter table ttk_versions add column organoleptic jsonb not null default '{}';   -- {appearance, color, consistency, taste}
alter table ttk_versions add column serving text;                               -- требования к оформлению и подаче
alter table ttk_versions add column menu_description text;                      -- описание для гостевого меню (информационный лист)

alter table product_nutrition add column dry_matter_100 numeric check (dry_matter_100 is null or dry_matter_100 between 0 and 100);
alter table product_nutrition add column sucrose_100 numeric check (sucrose_100 is null or sucrose_100 between 0 and 100);
alter table product_nutrition add column fat_mass_100 numeric check (fat_mass_100 is null or fat_mass_100 between 0 and 100);

create or replace function ttk_version_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Версия ТТК не удаляется'; end if;
  if old.status = 'archived' then raise exception 'Архивная версия ТТК не изменяется'; end if;
  if old.status = 'approved' and (new.status <> 'archived' or new.technology is distinct from old.technology or new.yield_g is distinct from old.yield_g
      or new.portion_g is distinct from old.portion_g or new.storage_conditions is distinct from old.storage_conditions or new.shelf_life is distinct from old.shelf_life
      or new.card_date is distinct from old.card_date or new.semi_yield_g is distinct from old.semi_yield_g
      or new.organoleptic is distinct from old.organoleptic or new.serving is distinct from old.serving) then
    raise exception 'Утверждённая ТТК не изменяется — создайте новую версию';
  end if;
  return new;
end $$;
