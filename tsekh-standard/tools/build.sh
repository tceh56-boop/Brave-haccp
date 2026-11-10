#!/usr/bin/env bash
# Сборка ЦЕХ Стандарт: оформление + экраны → проверка синтаксиса → тесты → архив для Google Диска.
#   bash tools/build.sh
# Результат: dist/TsekhStandard_Application.zip (загрузить в папку установки на Диске, не распаковывая)
#            dist/TsekhStandard_Admin.zip       (файлы проекта админ-панели)
set -euo pipefail
cd "$(dirname "$0")/.."
python3 tools/rebrand_monchef.py app brand >/dev/null
python3 tools/inject_ts_console.py app >/dev/null
node tools/check_syntax.js app
node tools/check_syntax.js admin
node tests/license_flow.test.js
mkdir -p dist && rm -f dist/*.zip
( cd app && zip -q -X ../dist/TsekhStandard_Application.zip *.gs *.html appsscript.json )
( cd brand && zip -q -X ../dist/TsekhStandard_Application.zip *.png )
( cd admin && zip -q -X ../dist/TsekhStandard_Admin.zip *.gs *.html appsscript.json )
ls -la dist
