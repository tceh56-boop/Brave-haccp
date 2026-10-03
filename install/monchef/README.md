# MonChef — установка на Google Диск

Папка на Диске: «MonChef — установка»
https://drive.google.com/drive/folders/199_Kpd04nbT8T4UCwfk3imarDHGJGvHw

Рабочая таблица (уже на Диске, `SHEET_ID` в Code.gs совпадает):
https://docs.google.com/spreadsheets/d/1yCYIBLdGHCpclL_NgpoX5Hf9zDy7MdLL7tBENjsdPNQ/edit

Сам архив с кодом в репозиторий не кладётся: репозиторий публичный, а код — собственность владельца.
Установщик берёт архив прямо с Диска.

## Шаги (один раз, ~5 минут)

1. Включите Apps Script API: https://script.google.com/home/usersettings → «Google Apps Script API» → Вкл.
2. Загрузите `MonChef_UI_BRANDED_NO_VERSIONS.zip` в папку «MonChef — установка» (как есть, не распаковывая).
3. Откройте https://script.google.com/create — новый пустой проект.
   - Замените содержимое `Код.gs` текстом `MonChefInstaller.gs`.
   - Настройки проекта (шестерёнка) → «Показывать файл манифеста appsscript.json»;
     замените содержимое `appsscript.json` текстом `installer_appsscript.json`.
   - Сохраните.
4. Выберите функцию `installMonChef` → **Выполнить** → разрешите доступ.
   В журнале появятся ссылки на проект «MonChef» и на веб-приложение.
5. Откройте проект «MonChef» по ссылке из журнала, выполните `installJournalTriggers` и разрешите доступ
   (Диск, таблицы, триггеры, внешние запросы).
6. «Порядок первого запуска» из README пакета: `createSystemBackup` → `validateMigrations` →
   `runFullMigration` → `runSafeTests` → `reconcileStock`.
7. Свойства скрипта (Настройки проекта → Свойства скрипта) — по необходимости:
   `ORG_ID`, `LOCATION_ID` (по умолчанию ORG-001 / LOC-001), `YANDEX_API_KEY`, `YANDEX_FOLDER_ID` для OCR.
   `PIN_SALT` создаётся автоматически при первом входе.

## Обновление

Положите новый .zip в ту же папку и снова запустите `installMonChef` в проекте-установщике.
Берётся самый свежий архив; обновляется тот же проект и то же развёртывание — ссылка не меняется.
Прежнее содержимое проекта сохраняется в папку как `backup_*.json`.

Чтобы обновить уже существующий проект вместо создания нового, впишите его ID в `MC_TARGET_SCRIPT_ID_`.
