#!/usr/bin/env bash
# Точка входа контейнера приложения (docker-compose.yml): подготовка базы и запуск сервера.
set -euo pipefail
cd "$(dirname "$0")/.."
bash deploy/prepare.sh
exec npx next start -p "${PORT:-3000}"
