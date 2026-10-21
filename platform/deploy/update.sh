#!/usr/bin/env bash
# Обновление системы на сервере до последней версии ветки: код → сборка → перезапуск. Данные сохраняются.
#   bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose --profile https up -d --build
docker image prune -f >/dev/null
echo "Обновлено. Проверка: curl -s http://127.0.0.1:3000/api/v1/health"
