# Mon Chef V45 — Production Task Bridge

V45 связывает единый центр задач V44 с реальным производственным заказом.

## Новый контур
`Банкет → V25 план → V44 задача → production_id → V27 старт → фактический выпуск → партия → V44 DONE`

### Правила
- Производственная задача не считается фактически выполненной только потому, что сотрудник нажал «Выполнено».
- `В работу` вызывает V27/V27-compatible production start.
- Закрытие V45 разрешено только если реальный production имеет статус `COMPLETED`.
- Списание сырья, выпуск партии, себестоимость, HACCP и трассировка остаются в производственном ядре.
- Автопривязка не создаёт новый production заказ автоматически: она сначала ищет существующий заказ по TTK/количеству/единице и маркирует уверенность.

## Листы
- `Задачи_Производство_Связи_V45`
- `Задачи_Производство_Аудит_V45`

## Функции
- `setupV45ProductionBridge`
- `v45AutoBindProductionTasks`
- `v45BindProductionTask`
- `v45GetProductionStatus`
- `v45StartProductionTask`
- `v45CompleteProductionTask`
- `v45RefreshProductionTaskStatuses`
- `v45GetDashboard`

## UI
`?productiontasks=1&token=...`

V45 не заявляет юридическое соответствие и не вводит нормативные значения.
