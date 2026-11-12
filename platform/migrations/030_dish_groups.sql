-- ЦЕХ — дерево папок блюд и полуфабрикатов (как группы в Шеф Эксперте) с правилами папки.
--  * Правила папки (нормируемая физико-химия, коэффициенты, микробиология, органолептика по умолчанию) наследуются
--    вложенными папками и блюдами; значение, заданное у блюда, сильнее.
--  * СТО может относиться к папке: в стандарт входят все блюда папки и её подпапок.
--  * Перенос: категории блюд и пути архива ТТК становятся папками.

create table dish_groups (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  parent_id       uuid references dish_groups(id),
  name            text not null,
  position        integer not null default 0,
  params          jsonb not null default '{}',
  created_by      uuid references users(id),
  created_at      timestamptz not null default now()
);
create unique index dish_groups_name_uniq on dish_groups(organization_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index dish_groups_parent_idx on dish_groups(organization_id, parent_id);

alter table dishes add column group_id uuid references dish_groups(id);
alter table sto_standards add column group_id uuid references dish_groups(id);

alter table dish_groups enable row level security;
create policy dish_groups_tenant on dish_groups for all to ceh_app
  using (organization_id = app_org_id() and app_is_member(organization_id)) with check (organization_id = app_org_id() and app_is_member(organization_id));
grant select, insert, update, delete on dish_groups to ceh_app;

-- перенос: путь архива (без служебного «ttk»), иначе категория блюда
do $$
declare d record; path text[]; parent uuid; gid uuid; part text;
begin
  for d in select x.id, x.organization_id, x.category, x.created_by, a.category_path from dishes x left join ttk_archive a on a.id = x.archive_id loop
    path := coalesce(array_remove(d.category_path, 'ttk'), case when coalesce(trim(d.category), '') <> '' then array[trim(d.category)] else '{}'::text[] end);
    parent := null;
    foreach part in array path loop
      select id into gid from dish_groups where organization_id = d.organization_id and parent_id is not distinct from parent and lower(name) = lower(part);
      if gid is null then
        insert into dish_groups (organization_id, parent_id, name, created_by) values (d.organization_id, parent, part, d.created_by) returning id into gid;
      end if;
      parent := gid; gid := null;
    end loop;
    if parent is not null then update dishes set group_id = parent where id = d.id; end if;
  end loop;
end $$;
