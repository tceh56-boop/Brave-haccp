# ЦЕХ Стандарт — образ сервера для Yandex Cloud.
# Сборка из каталога tsekh-standard (нужны app/, admin/ и cloud/):
#   docker build -f cloud/Dockerfile -t tsekh-standard .
ARG BASE_IMAGE=node:22.11.0-bookworm-slim
FROM ${BASE_IMAGE}

# Chromium — печать PDF (журналы, этикетки, акты); шрифты — кириллица в PDF; tzdata — часовые пояса предприятий;
# sqlite3 — горячая резервная копия базы (.backup); build-essential/python3 — сборка better-sqlite3, если нет готовой.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-dejavu-core fonts-liberation tzdata sqlite3 ca-certificates \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    CHROMIUM_PATH=/usr/bin/chromium \
    DATA_DIR=/data \
    PORT=8080 \
    TZ_DEFAULT=Asia/Yekaterinburg

WORKDIR /srv/tsekh/cloud
COPY cloud/package.json cloud/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
 && apt-get purge -y python3 make g++ && apt-get autoremove -y

COPY app /srv/tsekh/app
COPY admin /srv/tsekh/admin
COPY cloud/server.js ./
COPY cloud/lib ./lib
COPY cloud/tools ./tools

RUN useradd --system --uid 1001 --home /srv/tsekh tsekh && mkdir -p /data && chown tsekh /data
USER tsekh
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
