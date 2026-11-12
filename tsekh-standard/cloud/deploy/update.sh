#!/usr/bin/env bash
# Обновление: резервная копия → новая версия кода → пересборка → перезапуск. Данные (каталог data) не трогаются.
#   ./deploy/update.sh            — из каталога cloud
set -euo pipefail
cd "$(dirname "$0")/.."
./deploy/backup.sh
git pull --ff-only
docker compose up -d --build
sleep 5
docker compose ps
