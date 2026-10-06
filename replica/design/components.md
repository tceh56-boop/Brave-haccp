# Компоненты модуля «Касса» (дизайн-система ЦЕХ)

Классы CSS ЦЕХ переиспользуются: `.card`, `.subnav`, `button.btn` (+`.secondary/.danger/.small`),
`.badge`, `.chip`, `.muted`, `.err`, `.row-between`, `.grid2`. Новые — с префиксом `pos-`.
Цели нажатия ≥ 48 px (касса — палец, планшет).

```
PosLayout (S01 касса)
  layout   ≥900px: две колонки — меню слева (flex 1), чек справа (380px, sticky)
           <900px: меню, чек — нижняя панель «Чек · N поз · сумма» с раскрытием
  tokens   bg, surface, radius md, shadow card; max-width pos_max
  used on  S01, S02

CategoryBar
  = .subnav (горизонтальная прокрутка, активная — header/on-header)
  states   default, active, focus-visible
  used on  S01, S02

DishTile
  variants обычный, в стоп-листе (затемнён, бейдж «Стоп», disabled), с модификаторами (значок «+»)
  size     min 120×72, сетка auto-fill minmax(130px,1fr)
  states   default, hover, active (вдавлен), focus-visible (2px accent), disabled
  tokens   surface, text, цена — text-muted xs/600, radius sm
  a11y     <button>, aria-label «Название, цена», disabled для стопа
  used on  S01, S02

ModifierSheet (модальное окно)
  содержимое группы (radio при макс=1, checkbox иначе), обязательные помечены, итог цены
  states   невалидно (кнопка «Добавить» disabled + текст ошибки), валидно
  a11y     role=dialog, aria-modal, фокус на первом поле, Esc закрывает
  used on  S01, S02

OrderTicket (чек)
  строки: название, модификаторы (muted), qty −/+ (48px), сумма; итог крупно xl
  states   пусто («Добавьте блюда из меню»), есть позиции, отправлено на кухню (бейдж info), пречек (заблокирован)
  used on  S01, S02

PayPanel
  способы: Наличные / Карта / Прочее (сегменты), сумма, «Сдача», кнопка «Оплатить» (accent, lg 56px)
  states   default, loading («Проводим оплату…», кнопка disabled, повторное нажатие невозможно),
           ошибка (err + «Повторить» с тем же operationId), успех (зелёный бейдж, «Новый заказ»)
  used on  S01

TableTile (S03 зал)
  variants свободен (surface), занят (accent-рамка + сумма + время), пречек (brand), чужой (официант, muted)
  states   + focus-visible, loading
  used on  S02, S03

ShiftCard (S05 смена)
  закрыта: форма «Нал на начало» + «Открыть смену»
  открыта: KPI (.kpi) — заказов, выручка нал/карта, средний чек; кнопки «X-отчёт», «Закрыть смену»
  закрытие: ввод фактического нала, расхождение (danger при ≠0)
  used on  S01, S05

StopListRow (S04)
  блюдо, причина, источник (бейдж «авто»/«вручную»), «Снять»
  used on  S04

StatusBadge
  открыт — info; пречек — brand; оплачен — success; отменён/возврат — danger; на кухне — warning (текст on-warning)
```

Пустые состояния (свои тексты): «Смена не открыта — откройте смену, чтобы принимать заказы»,
«В зале пока нет столов — добавьте их в настройках кассы», «Стоп-лист пуст — всё в продаже».
