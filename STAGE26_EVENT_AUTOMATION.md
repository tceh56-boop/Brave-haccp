# ЦЕХ CORE100 — Stage 26: Event-Driven Automation

## Цель
Перевести Automation Engine с периодического опроса Control Tower на событийный контур:
`EVENTS -> AUTOMATION_RULES -> AUTOMATION_EVENT_DISPATCH -> AUTOMATION_DECISIONS`.

## Безопасность
- Событийный слой не меняет склад, деньги, производство или HACCP напрямую.
- Разрешены только действия белого списка Stage 25.
- Денежные/складские/производственные изменения требуют существующего согласования Stage 25.
- Каждая пара event+rule имеет идемпотентный dispatch key.
- Исторические события до первой активации Stage 26 не обрабатываются автоматически: сохраняется epoch в Script Properties.
- API фильтрует организацию и точку по текущей сессии.

## Правила по умолчанию
При первой обработке точки создаются идемпотентно правила для:
- EXPIRY_WARNING -> CREATE_TASK
- DEVIATION_CREATED -> CREATE_TASK
- TASK_OVERDUE -> CREATE_TASK
- LAB_RESULT_FAILED -> CREATE_TASK
- SAFETY_TEST_FAILED -> CREATE_TASK

## API
- `GET_EVENT_AUTOMATION_RULES`
- `CREATE_EVENT_AUTOMATION_RULE`
- `SET_EVENT_AUTOMATION_RULE_STATUS`
- `RUN_EVENT_AUTOMATION`

## Триггер
`eventAutomationStage26Trigger_` — каждые 15 минут. Обрабатывается не более 50 совпадений за запуск.

## UI
На Dashboard добавлен блок «Событийная автоматизация» с активными правилами и ручным запуском обработки.

## Граница Stage 26
Автономное выполнение финансовых платежей, списаний, запуска производства и изменения HACCP не включено. События только создают безопасные предложения Stage 25.
