#!/usr/bin/env bash
# Первичная установка ЦЕХ Стандарт на виртуальную машину Yandex Cloud (Ubuntu 22.04/24.04).
# Запуск на ВМ из каталога cloud клонированного репозитория:  sudo ./deploy/yandex-install.sh
# Скрипт ставит Docker, спрашивает домен и почту, собирает и запускает сервер, создаёт админ-панель
# и первое предприятие, ставит ежедневную резервную копию. Пароли и ключи вводятся только здесь, на сервере.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "== Установка Docker"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release; echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

if [ ! -f .env ]; then
  cp .env.example .env
  read -rp "Домен (A-запись уже указывает на IP этой ВМ): " DOMAIN
  read -rp "Почта для Let's Encrypt (Enter — пропустить): " ACME
  read -rp "Часовой пояс по умолчанию [Asia/Yekaterinburg]: " TZD
  TZD=${TZD:-Asia/Yekaterinburg}
  CORES=$(nproc); W=$(( CORES > 4 ? 4 : (CORES < 2 ? 1 : CORES) ))
  sed -i "s#^DOMAIN=.*#DOMAIN=$DOMAIN#; s#^APP_URL=.*#APP_URL=https://$DOMAIN#; s#^ACME_EMAIL=.*#ACME_EMAIL=$ACME#; s#^TZ_DEFAULT=.*#TZ_DEFAULT=$TZD#; s#^WORKERS=.*#WORKERS=$W#" .env
  echo "Почта (SMTP Яндекс 360) и резервные копии (Object Storage) настраиваются в .env — можно позже."
fi
mkdir -p data && chown 1001 data

echo "== Сборка и запуск"
docker compose up -d --build
for i in $(seq 1 30); do docker compose exec -T app node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break; sleep 2; done

if [ ! -f data/_admin/tenant.json ]; then
  read -rp "Почта владельца админ-панели (поставщик): " AEMAIL
  docker compose exec -T app node tools/tenant.js admin --email "$AEMAIL"
fi

read -rp "Создать предприятие сейчас? [y/N]: " YN
if [[ "$YN" =~ ^[YyДд] ]]; then
  read -rp "Код предприятия (латиница, например kafe-ural): " SLUG
  read -rp "Название: " NAME
  read -rp "Почта директора: " EMAIL
  read -rsp "Код технического доступа (6 цифр, не показывается): " PIN; echo
  docker compose exec -T app node tools/tenant.js create "$SLUG" --name "$NAME" --email "$EMAIL" --pin "$PIN"
  echo "Ключ лицензии: создайте клиента в админ-панели и привяжите ключ —"
  echo "  docker compose exec app node tools/tenant.js props $SLUG TS_LICENSE_KEY=<ключ> TS_LICENSE_SECRET=<секрет> TS_ADMIN_URL=https://$(grep ^DOMAIN= .env | cut -d= -f2)/admin/exec"
fi

echo "== Ежедневная резервная копия в 03:30"
chmod +x deploy/*.sh
( crontab -l 2>/dev/null | grep -v 'deploy/backup.sh'; echo "30 3 * * * cd $PWD && ./deploy/backup.sh >> data/backup.log 2>&1" ) | crontab -

. ./.env
echo
echo "Готово. Админ-панель: https://$DOMAIN/admin/exec"
echo "Предприятия: https://$DOMAIN/t/<код>/exec"
