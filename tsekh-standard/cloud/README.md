# ЦЕХ Стандарт в Yandex Cloud

Этот каталог позволяет запускать ЦЕХ Стандарт на своём сервере без Google. Код приложения (`../app`) и админ-панели (`../admin`) тот же, что устанавливался в Google Apps Script, и **не переписан**: сервер выполняет файлы `.gs` как есть. Службы Google, к которым обращается код, заменены своими. Данные хранятся на диске виртуальной машины в Yandex Cloud, резервные копии уходят в Yandex Object Storage, то есть всё остаётся в России.

| Было в Google | Стало на сервере |
|---|---|
| Google Таблицы (`SpreadsheetApp`) | SQLite: одна база на предприятие, листы и строки в ней |
| Google Диск (`DriveApp`, Drive REST: копирование с конвертацией, экспорт) | Файлы на диске сервера. Excel и CSV превращаются в таблицу, Word в документ, PDF и фото в текст через Yandex Vision |
| Google Документы (`DocumentApp`) | Документы в базе. PDF печатается через Chromium |
| Gmail / `MailApp` | Очередь писем и SMTP Яндекс 360 |
| Триггеры Apps Script | Планировщик: отдельный процесс, проверка раз в 30 с |
| `PropertiesService`, `CacheService`, `LockService` | Таблицы в той же базе. Блокировка работает и между процессами |
| `HtmlService` и `google.script.run` | Те же страницы `.html`. Вызовы идут на `/t/<код>/rpc` |
| `UrlFetchApp` (Yandex Vision, YandexGPT, Меркурий, ЮKassa) | Обычные HTTPS-запросы с сервера |
| Веб-приложение `script.google.com/…/exec` | `https://домен/t/<код>/exec` |
| Админ-панель поставщика | `https://домен/admin/exec` |

Одна установка обслуживает много предприятий. У каждого свой каталог `data/<код>` со своей базой и файлами.

## Установка на виртуальную машину Yandex Cloud

1. Создайте ВМ в Compute Cloud: Ubuntu 22.04 или 24.04, 2 vCPU и 4 ГБ (до ~20 предприятий) или 4 vCPU и 8 ГБ, SSD от 30 ГБ, публичный статический IP.
2. В DNS добавьте A-запись домена на этот IP. Откройте порты 80 и 443 в группе безопасности.
3. На ВМ выполните:
   ```bash
   git clone <репозиторий> tsekh && cd tsekh/tsekh-standard/cloud
   sudo ./deploy/yandex-install.sh
   ```
   Скрипт ставит Docker, спрашивает домен, собирает и запускает сервер, а HTTPS-сертификат выпускается автоматически. Затем он создаёт админ-панель, при желании первое предприятие, и ставит ежедневную резервную копию на 03:30.
4. Почта и резервные копии в Object Storage настраиваются в `.env` (образец в `.env.example`). После изменения выполните `docker compose up -d`.

Если Docker Hub с ВМ недоступен, базовый образ можно взять из зеркала:
`docker compose build --build-arg BASE_IMAGE=<зеркало>/library/node:22.11.0-bookworm-slim`.

## Ежедневная работа

Команды выполняются в каталоге `cloud` на сервере:

```bash
docker compose exec app node tools/tenant.js list                       # предприятия
docker compose exec app node tools/tenant.js create kafe-ural --name "Кафе Урал" --email director@kafe.ru --pin 123456
docker compose exec app node tools/tenant.js props kafe-ural            # свойства (секреты скрыты)
docker compose exec app node tools/tenant.js props kafe-ural YANDEX_API_KEY=… YANDEX_FOLDER_ID=…
docker compose exec app node tools/tenant.js triggers kafe-ural         # фоновые задачи
docker compose exec app node tools/tenant.js log kafe-ural 50           # журнал выполнения
docker compose exec app node tools/tenant.js run kafe-ural installAllTriggers  # выполнить функцию, как «Выполнить» в редакторе
./deploy/backup.sh                                                       # резервная копия сейчас
./deploy/update.sh                                                       # копия, git pull, пересборка
```

Ключи Yandex Vision, YandexGPT, ЮKassa и пароли SMTP вводит владелец на сервере. В репозиторий они не попадают.

### Лицензия предприятия

1. В админ-панели (`/admin/exec`) создайте клиента. Панель покажет ключ и секрет лицензии.
2. Свяжите предприятие с панелью:
   `docker compose exec app node tools/tenant.js props kafe-ural TS_LICENSE_KEY=<ключ> TS_LICENSE_SECRET=<секрет> TS_ADMIN_URL=https://домен/admin/exec`
3. Предприятие само проверяет лицензию по расписанию. Ответ панели подписан HMAC, как и в Google.

## Перенос данных из Google

1. В Google Таблицах откройте базу предприятия и выберите «Файл → Скачать → Microsoft Excel (.xlsx)». Файлы с Диска (ТТК, документы) скачайте архивом.
2. Положите их в папки предприятия через интерфейс ЦЕХ Стандарт. Загрузка ТТК из Excel и Word, распознавание PDF и фото работают так же, как в Google.

Инструмент, который переносит всю базу одной командой, ещё не сделан. Это следующий шаг.

## Устройство

- `server.js`: HTTP-сервер. Несколько процессов обрабатывают запросы (`WORKERS`), ещё один отвечает за планировщик и почту.
- `lib/runtime.js`: склеивает файлы `.gs` в том же порядке, что и установщик, компилирует их один раз и при каждом выполнении создаёт свежую область видимости, как в Apps Script.
- `lib/store.js`: хранилище предприятия (SQLite, режим WAL).
- `lib/gas/*`: службы `SpreadsheetApp`, `DriveApp`, `DocumentApp`, `UrlFetchApp`, `Utilities` и другие.
- `lib/scheduler.js`, `lib/mailer.js`: триггеры по времени и отправка писем.
- `tools/tenant.js`: управление предприятиями.
- `deploy/`: установщик для Yandex Cloud, Caddy (HTTPS), резервные копии и обновление.
- `test/`: `npm test`.

Запуск для разработки без Docker (нужны Node 22 и Chromium):

```bash
npm ci
SINGLE_PROCESS=1 DATA_DIR=./data node tools/tenant.js create demo --name "Демо" --pin 123456
SINGLE_PROCESS=1 DATA_DIR=./data node server.js     # http://localhost:8080/t/demo/exec
```

## Чего пока нет

- **Формулы в ячейках** хранятся, но не вычисляются. Код ЦЕХ Стандарт считает всё сам, формулы есть только в выгрузках для людей.
- **Конвертация .xls, .ods, .rtf, .doc** не поддерживается. Код попросит сохранить файл как .xlsx или .docx.
- **Многостраничный PDF** распознаётся только по первой странице: синхронный метод Yandex Vision обрабатывает одну.
- **Триггер «при изменении таблицы»** (`onEdit`) не срабатывает, потому что таблицу правят только через интерфейс приложения.
- **Ссылки на файлы** (`/t/<код>/file/<id>`) защищены только длинным случайным идентификатором (44 символа), как ссылки «доступ по ссылке» в Google.
- `GmailApp`, `CalendarApp`, `Charts`, `FormApp`, `SlidesApp` и расширенные службы Drive и Sheets возвращают понятную ошибку. Основной код ЦЕХ Стандарт их не использует.
