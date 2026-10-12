# ЦЕХ в Yandex Cloud

Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.

Облачная версия запускает **тот же код `gas/*.gs`**, что и Apps Script, без правок бизнес-логики.
Меняется только «нижний этаж»: вместо Google-таблицы — PostgreSQL, вместо `google.script.run` — HTTP.

```
Браузер ──HTTPS──▶ API Gateway ──▶ Serverless Container (Node 22)
                    (/ , /api)       ├─ cloud/src/server.js   HTTP: интерфейс, /api, /cron
                                     ├─ cloud/src/runtime.js  gas/*.gs + заменители сервисов Apps Script
                                     ├─ cloud/src/store.js    «листы», свойства, кэш, блокировка → PostgreSQL
                                     └─ cloud/src/syncpg.js   синхронный мост к pg (поток + Atomics.wait)
Таймеры Yandex Cloud ──▶ /cron (tick15m_, tickHourly_, …)         │
Lockbox (секреты) ──▶ переменные TSEKH_PROP_*                     ▼
                                                     Managed PostgreSQL 16 (Россия, бэкапы)
```

## Почему так
- **152-ФЗ**: телефоны гостей и данные сотрудников хранятся в базе в России.
- **Доступ к российским сервисам** (ЕГАИС через мост УТМ, «Честный знак», АТОЛ Онлайн, Yandex Vision/AI Studio) — из российского облака.
- **Нет лимитов Apps Script**: 6 минут на выполнение, 20 триггеров, кэш 100 КБ. Блокировка записи — общая
  для всех экземпляров (рекомендательная блокировка PostgreSQL).
- **Без переписывания**: все 16 наборов тестов ЦЕХ проходят на PostgreSQL (`node cloud/test/run-all.js`).

## Что пока отличается от Apps Script
| В Apps Script | В облаке сейчас | Дальше |
| --- | --- | --- |
| Копия таблицы на Google Диск каждую ночь | Отключено: бэкапы делает Managed PostgreSQL | — |
| Файлы на Google Диске (документы поставщиков, инструкции охраны труда, пакеты доказательств) | Yandex Object Storage (или прямо в базе, если бакет не задан); ссылка `files/<id>` открывается только сотруднику той же организации | — |
| PDF из HTML (`getAs(PDF)`) | Недоступно — печать из браузера | Генерация PDF в контейнере |
| Почта `MailApp` | Очередь `tsekh_mail` → Yandex Cloud Postbox каждые 15 минут, до 5 попыток, ошибка с причиной | — |
| Хранение — строки «листов» в `tsekh_rows` (jsonb) | Как таблица, один в один | Этап 2: таблицы с индексами для больших листов (продажи, журналы) |

Пока поток ждёт базу, экземпляр не обслуживает другие запросы — как Apps Script. Нагрузку держат несколько
экземпляров контейнера (параметр concurrency = 1, экземпляров — по числу точек).

## Переменные окружения
| Переменная | Зачем | Где взять |
| --- | --- | --- |
| `DATABASE_URL` | база | Managed PostgreSQL (шаг 2) |
| `CRON_SECRET` / `TSEKH_CRON_FROM_TRIGGER=1` | доступ к `/cron` | придумать длинную строку / для таймеров Yandex Cloud |
| `TSEKH_S3_BUCKET`, `TSEKH_S3_ENDPOINT` (`https://storage.yandexcloud.net`) | файлы в Object Storage | бакет без публичного доступа |
| `YC_ACCESS_KEY_ID`, `YC_SECRET_ACCESS_KEY` | подпись запросов к Object Storage и Postbox | статический ключ сервисного аккаунта (роли `storage.editor`, `postbox.sender`) |
| `TSEKH_MAIL_FROM`, `TSEKH_POSTBOX_ENDPOINT` (`https://postbox.cloud.yandex.net`) | почта | адрес на домене, подтверждённом в Postbox |
| `TSEKH_PROP_<ИМЯ>` | секреты интеграций (ключ Vision, токен Telegram) | Lockbox |
| `TSEKH_PROP_YANDEX_AI_API_KEY`, `TSEKH_PROP_YANDEX_FOLDER_ID`, `TSEKH_PROP_YANDEX_AI_MODEL` (`yandexgpt/latest`), `TSEKH_PROP_YANDEX_AI_ENDPOINT` | ИИ-директор (Yandex AI Studio) | API-ключ сервисного аккаунта с ролью `ai.languageModels.user`, ID каталога |
Подпись запросов (AWS SigV4) проверена на официальном примере AWS; адрес и формат API Postbox сверьте с документацией перед запуском.

## Проверка на компьютере
```bash
cd cloud && npm ci && cd ..
# отдельная пустая тестовая база — она очищается!
export DATABASE_URL=postgres://user@127.0.0.1:5432/tsekh_test
node cloud/test/run-all.js            # тесты ЦЕХ на PostgreSQL + облачные + браузер
node cloud/test/run-all.js --no-browser
# запустить локально
DATABASE_URL=postgres://.../tsekh node cloud/src/migrate.js   # листы + первый директор (PIN печатается один раз)
DATABASE_URL=postgres://.../tsekh CRON_SECRET=длинная-строка node cloud/src/server.js   # http://localhost:8080
```

## Развёртывание в Yandex Cloud (по шагам)
Команды `yc` — ориентир: сверьте флаги с текущей документацией Yandex Cloud перед запуском.

1. **Каталог и сервисный аккаунт**: `tsekh-sa` с ролями `serverless.containers.invoker`,
   `container-registry.images.puller`, `lockbox.payloadViewer`.
2. **Managed PostgreSQL 16**: кластер в зоне `ru-central1`, база `tsekh`, пользователь `tsekh`.
   Строка подключения: `postgres://tsekh:<пароль>@<host>:6432/tsekh?sslmode=verify-full&sslrootcert=/app/yandex-ca.pem`
   (сертификат уже лежит в образе).
3. **Lockbox**: секрет `tsekh` с ключами `DATABASE_URL`, `CRON_SECRET` и секретами интеграций
   (`TSEKH_PROP_YANDEX_OCR_API_KEY`, `TSEKH_PROP_TSEKH_TELEGRAM_BOT_TOKEN` и т. п. — имена свойств Apps Script с префиксом `TSEKH_PROP_`).
4. **Образ**: `docker build -f Dockerfile.cloud -t cr.yandex/<registry-id>/tsekh:<версия> .` и `docker push`.
5. **Установка базы** (один раз, с компьютера с доступом к кластеру): `DATABASE_URL=... node cloud/src/migrate.js` —
   запишите PIN первого директора.
6. **Перенос данных из Google-таблицы** (если ЦЕХ уже работает):
   в редакторе Apps Script запустить `exportForCloud()` (файл `gas/CloudExport.gs`) → скачать с Диска
   `tsekh_export_ГГГГ-ММ-ДД.json` → `DATABASE_URL=... node cloud/src/import.js tsekh_export_….json` → снова `migrate.js`.
   Секреты в файл не выгружаются — их список печатается, задайте их в Lockbox (шаг 3).
7. **Serverless Container** `tsekh`: ревизия из образа, память 512 МБ, concurrency 1, секреты Lockbox как переменные,
   сервисный аккаунт `tsekh-sa`, **без публичного доступа**. Переменная `TSEKH_CRON_FROM_TRIGGER=1`.
8. **API Gateway** по `cloud/deploy/api-gateway.yaml` (наружу только `/`, `/api`, `/health`; `/cron` — нет).
   Свой домен и сертификат — через Certificate Manager.
9. **Таймеры** (тип «таймер», вызов контейнера, сообщение = имя задачи), как `installTriggers()` в Apps Script:
   `tick15m_` — каждые 15 мин; `tickHourly_` — каждый час (он же запускает ежедневные задачи в их час);
   `tick2hA_`, `tick2hB_` — каждые 2 ч; `tick4h_` — каждые 4 ч; `tick6h_` — каждые 6 ч.
10. **Проверка**: `https://<шлюз>/health` → `{"ok":true}`, вход директора по PIN, открыть кассу.

## Переход точек
Сначала одна точка работает в облаке, остальные — в Apps Script; выгрузка → загрузка повторяется,
пока не переедут все. После переезда Google-таблицу перевести в «только чтение» как архив.

## Следующие этапы
1. Хранилище файлов (Object Storage), почта (Postbox), PDF.
2. Таблицы с индексами для больших листов (продажи, журналы, аудит) — под той же прослойкой.
3. Мост к УТМ ЕГАИС — вызывает `/api` с ключом точки.
4. ~~ИИ-агент на Yandex AI Studio~~ — сделано (`gas/AiAgent.gs`, работает и в Apps Script): 13 инструментов чтения с правами спросившего,
   изменения — только предложениями (задача, заявка, лист заготовок, проверка фуд-коста, стоп) с кнопкой «Выполнить», журнал `AI_AGENT_LOG`, 60 вопросов в час.
