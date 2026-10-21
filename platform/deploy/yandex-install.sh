#!/usr/bin/env bash
# Установка ЦЕХ на виртуальную машину Yandex Cloud (Ubuntu 22.04 / 24.04) — одной командой из каталога репозитория:
#   sudo bash platform/deploy/yandex-install.sh
# Ставит Docker, задаёт настройки (.env) вопросами, собирает и запускает систему с HTTPS, включает ежедневные копии.
# Повторный запуск безопасен: готовый .env не перезаписывается, данные сохраняются.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Запустите через sudo: sudo bash $0"; exit 1; }
cd "$(dirname "$0")/.."
DIR="$(pwd)"
say() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
ask() { local q="$1" def="${2:-}" a=""; { read -r -p "$q${def:+ [$def]}: " a </dev/tty; } 2>/dev/null || read -r a || true; echo "${a:-$def}"; }

say "1/5 Docker"
if ! docker compose version >/dev/null 2>&1; then
  apt-get update -q
  apt-get install -y -q docker.io docker-compose-v2 cron openssl curl
fi
systemctl enable --now docker >/dev/null 2>&1 || true
# зеркало Docker Hub: если основной реестр недоступен, образы берутся с зеркала (и наоборот)
if [ ! -f /etc/docker/daemon.json ]; then
  echo '{ "registry-mirrors": ["https://mirror.gcr.io"] }' > /etc/docker/daemon.json
  systemctl restart docker
fi
docker compose version

say "2/5 Настройки (.env)"
if [ -f .env ]; then
  echo "Файл .env уже есть — оставляю как есть ($DIR/.env)."
else
  IP="$(curl -s -m 3 -H 'Metadata-Flavor: Google' http://169.254.169.254/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip || true)"
  [ -n "$IP" ] || IP="$(curl -s -m 5 https://ifconfig.me || true)"
  echo "Публичный IP сервера: ${IP:-не определился}. Нет своего домена — подойдёт ${IP:-<IP>}.sslip.io"
  DOMAIN="$(ask 'Домен системы (например ceh.вашкафе.ru)' "${IP:+$IP.sslip.io}")"
  echo
  echo "Почта для писем (приглашения, подтверждение email, сброс пароля)."
  echo "Яндекс 360: smtps://ВАШ_ЯЩИК%40домен.ru:ПАРОЛЬ_ПРИЛОЖЕНИЯ@smtp.yandex.ru:465  (@ в имени ящика пишется как %40)"
  echo "Пустой ответ — письма будут видны в ящике стенда https://$DOMAIN/mail/ (для первого запуска этого достаточно)."
  SMTP_URL="$(ask 'SMTP_URL' '')"
  MAIL_FROM=""
  [ -n "$SMTP_URL" ] && MAIL_FROM="$(ask 'Адрес отправителя (как в ящике), например ЦЕХ <ceh@вашкафе.ru>' '')"
  echo
  echo "Резервные копии в Object Storage (бакет и статический ключ сервисного аккаунта). Пустой ответ — только на сервере."
  S3_BUCKET="$(ask 'Имя бакета' '')"
  S3_ACCESS_KEY_ID=""; S3_SECRET_ACCESS_KEY=""
  if [ -n "$S3_BUCKET" ]; then
    S3_ACCESS_KEY_ID="$(ask 'Идентификатор ключа (YCAJ…)' '')"
    S3_SECRET_ACCESS_KEY="$(ask 'Секретный ключ' '')"
  fi
  DEMO="$(ask 'Создать демо-организацию «Кафе «Демо»» для показа? 1 — да, 0 — нет' '0')"
  MAIL_PASS="$(openssl rand -hex 12)"
  umask 077
  cat > .env <<ENV
# Настройки ЦЕХ на сервере. Создано $(date '+%F %T'). Файл содержит пароли — не публикуйте его.
DOMAIN=$DOMAIN
APP_URL=https://$DOMAIN
APP_BIND=127.0.0.1
DB_PASSWORD=$(openssl rand -hex 24)
MAIL_UI_AUTH=admin:$MAIL_PASS
SMTP_URL='${SMTP_URL:-smtp://mail:1025}'
MAIL_FROM='${MAIL_FROM:-ЦЕХ <no-reply@$DOMAIN>}'
DEMO=$DEMO
S3_BUCKET=$S3_BUCKET
S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY
ANTHROPIC_API_KEY=
ENV
  echo "Сохранено в $DIR/.env (доступ только у root)."
fi
set -a; . ./.env; set +a

say "3/5 Сборка и запуск (первый раз 3–7 минут)"
docker compose --profile https up -d --build
for i in $(seq 1 90); do curl -fs http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1 && break; sleep 3; done
curl -fs http://127.0.0.1:3000/api/v1/health || { echo; echo "Система не ответила. Журнал: docker compose logs app --tail 50"; exit 1; }
echo

say "4/5 Ежедневная резервная копия (03:15)"
cat > /etc/cron.d/ceh-backup <<CRON
SHELL=/bin/bash
15 3 * * * root cd $DIR && bash deploy/backup.sh >> /var/log/ceh-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/ceh-backup
bash deploy/backup.sh >> /var/log/ceh-backup.log 2>&1 && echo "Первая копия сделана и проверена." || echo "Первая копия не удалась — см. /var/log/ceh-backup.log"

say "5/5 Готово"
cat <<DONE
  Система:        https://$DOMAIN   (сертификат выпускается автоматически за 1–2 минуты)
  Письма стенда:  https://$DOMAIN/mail/   логин и пароль: $MAIL_UI_AUTH
  Дальше:         откройте систему → «Регистрация» → создайте предприятие (вы станете владельцем).
  Обновление:     cd $DIR && sudo bash deploy/update.sh
  Копии:          /var/log/ceh-backup.log; вручную — sudo bash deploy/backup.sh
DONE
