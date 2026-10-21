#!/usr/bin/env bash
# Демо-стенд в GitHub Codespaces (.devcontainer). setup — один раз при создании, start — при каждом включении.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${CODESPACE_NAME:-}" ]; then
  export APP_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
else
  export APP_URL="http://localhost:3000"
fi

case "${1:-}" in
  setup)
    npm ci --legacy-peer-deps --no-audit --no-fund
    bash deploy/prepare.sh
    npm run build
    ;;
  start)
    pkill -f "next start" 2>/dev/null || true
    pkill -f "sender.ts --watch" 2>/dev/null || true
    nohup setsid npx next start -p 3000 > /tmp/ceh-app.log 2>&1 < /dev/null &
    nohup setsid npm run -s mail:watch > /tmp/ceh-mail.log 2>&1 < /dev/null &
    echo "ЦЕХ запускается: $APP_URL  (журнал: /tmp/ceh-app.log)"
    echo "Вход: vladelec@demo.test / Демо-ЦЕХ-2026; письма — вкладка «Порты» → «Почта (Mailpit)»"
    ;;
  *) echo "использование: codespace.sh setup|start"; exit 1 ;;
esac
