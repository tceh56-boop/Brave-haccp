#!/usr/bin/env bash
# Резервная копия всех предприятий: горячая копия каждой базы SQLite (.backup, без остановки) + файлы «Диска»,
# архив tar.gz, загрузка в Yandex Object Storage. Запускается cron'ом ежедневно (ставит yandex-install.sh).
#   ./deploy/backup.sh            — из каталога cloud
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a

STAMP=$(date +%Y-%m-%d_%H%M)
WORK=data/_backup/$STAMP

for cfg in data/*/tenant.json; do
  slug=$(basename "$(dirname "$cfg")")
  [ "$slug" = "_backup" ] && continue
  # каталог создаёт сам контейнер (пользователь tsekh), иначе sqlite3 внутри не сможет в него писать
  docker compose exec -T app mkdir -p "/data/_backup/$STAMP/$slug"
  # .backup внутри контейнера: база в режиме WAL копируется согласованно, сервер продолжает работать
  docker compose exec -T app sqlite3 "/data/$slug/tenant.sqlite" ".backup '/data/_backup/$STAMP/$slug/tenant.sqlite'"
  cp "$cfg" "$WORK/$slug/"
  [ -d "data/$slug/drive" ] && cp -a "data/$slug/drive" "$WORK/$slug/"
done

ARCHIVE=data/_backup/tsekh-$STAMP.tar.gz
tar -czf "$ARCHIVE" -C data/_backup "$STAMP"
rm -rf "$WORK"
# архив читается целиком (иначе испорченная копия выяснится только при восстановлении)
tar -tzf "$ARCHIVE" > /dev/null
SIZE=$(stat -c %s "$ARCHIVE")
SUM=$(sha256sum "$ARCHIVE" | cut -d' ' -f1)
echo "$SUM  $(basename "$ARCHIVE")" > "$ARCHIVE.sha256"
echo "Архив: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1)), SHA-256 $SUM"

# Итог копии — в data/_backup/STATUS (его видно в одном месте; аудит 16.11.2026, H-02)
status() { printf '%s %s\n' "$(date -Iseconds)" "$*" > data/_backup/STATUS; echo "$*"; }

# Object Storage: каждый день — в daily/ (правило бакета удаляет через 30 дней), раз в месяц — ещё и в monthly/
# (правило бакета: холодное хранение, удаление через 1200 дней). Журналы СанПиН хранятся три года, ежемесячные копии — с запасом.
s3() {
  docker run --rm -v "$PWD/data/_backup:/b:ro" \
    -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION=ru-central1 \
    amazon/aws-cli:2.17.0 --endpoint-url "${S3_ENDPOINT:-https://storage.yandexcloud.net}" "$@"
}
# после загрузки размер объекта в бакете сверяется с архивом; контрольная сумма лежит рядом (.sha256)
put() {
  local key="$1" got
  s3 s3 cp "/b/$NAME" "$BASE/$key/$NAME" --metadata "sha256=$SUM"
  s3 s3 cp "/b/$NAME.sha256" "$BASE/$key/$NAME.sha256"
  got=$(s3 s3api head-object --bucket "$S3_BUCKET" --key "${S3_PREFIX:-tsekh-backups}/$key/$NAME" --query ContentLength --output text)
  if [ "$got" != "$SIZE" ]; then status "ОШИБКА: в бакете $key/$NAME размер $got, у архива $SIZE"; exit 1; fi
}
# заблаговременно: без этого cron-запуск тихо «успешен», а копий вне сервера нет
if [ -z "${S3_BUCKET:-}" ]; then
  status "НЕ ГОТОВО: S3_BUCKET не задан — архив только на диске сервера; при потере сервера данные (журналы СанПиН хранятся 3 года) не восстановить"
  ls -1t data/_backup/tsekh-*.tar.gz 2>/dev/null | tail -n +8 | while read -r f; do rm -f "$f" "$f.sha256"; done
  exit 2
fi
NAME=$(basename "$ARCHIVE"); BASE="s3://$S3_BUCKET/${S3_PREFIX:-tsekh-backups}"
put daily
echo "Загружено и сверено: $BASE/daily/$NAME"
# первая успешная копия месяца (даже если 1-го сервер был выключен)
MONTH=$(date +%Y-%m)
if [ ! -f "data/_backup/monthly-$MONTH.done" ]; then
  put monthly
  date -Iseconds > "data/_backup/monthly-$MONTH.done"
  echo "Ежемесячная копия (хранится 3+ года): $BASE/monthly/$NAME"
fi
status "OK: $NAME, $SIZE байт, SHA-256 $SUM, в бакете $S3_BUCKET сверено"

# локально держим последние 7 архивов; в Object Storage срок хранения задаётся правилом жизненного цикла бакета
ls -1t data/_backup/tsekh-*.tar.gz 2>/dev/null | tail -n +8 | while read -r f; do rm -f "$f" "$f.sha256"; done
