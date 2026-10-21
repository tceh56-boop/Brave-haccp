#!/usr/bin/env bash
# Ежедневная резервная копия на сервере: копия базы → проверка восстановления → выгрузка в Object Storage.
# Запускается по расписанию (cron, ставит yandex-install.sh) из каталога platform:  bash deploy/backup.sh
# Настройки — в .env: S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (без них копия остаётся только на сервере).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
log() { echo "$(date '+%F %T') $*"; }

log "копия базы"
docker compose exec -T app npm run -s backup
log "проверка восстановления"
docker compose exec -T app npm run -s backup:verify
# старые копии на сервере удаляем; в хранилище срок задаётся правилом жизненного цикла бакета
docker compose exec -T app find /backups -maxdepth 1 -type f -mtime +"$KEEP_DAYS" -delete

if [ -n "${S3_BUCKET:-}" ]; then
  log "выгрузка в s3://$S3_BUCKET/ceh-backups/"
  docker run --rm --volumes-from "$(docker compose ps -q app)":ro \
    -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" -e AWS_DEFAULT_REGION=ru-central1 \
    amazon/aws-cli:2.27.50 --endpoint-url "${S3_ENDPOINT:-https://storage.yandexcloud.net}" s3 sync /backups "s3://$S3_BUCKET/ceh-backups/" --only-show-errors
fi
log "готово"
