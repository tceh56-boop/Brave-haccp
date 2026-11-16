#!/usr/bin/env bash
# Подготовка базы стенда: дождаться PostgreSQL, миграции, справочники, при DEMO=1 — демо-организация.
# Все шаги повторяемы: при каждом запуске ничего не дублируется.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Жду базу данных…"
for i in $(seq 1 60); do
  node -e "const c=new (require('pg').Client)(process.env.DATABASE_URL);c.connect().then(()=>c.end()).then(()=>process.exit(0),()=>process.exit(1))" && break
  [ "$i" = 60 ] && { echo "База недоступна: $DATABASE_URL"; exit 1; }
  sleep 2
done

npm run -s migrate
npm run -s import:reference
npm run -s import:ttk
if [ "${DEMO:-0}" = "1" ]; then
  # стенд: демо-организация с известным паролем создаётся осознанно
  DEMO_FORCE=1 npm run -s demo:seed
fi
