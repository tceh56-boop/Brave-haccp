# Образ приложения ЦЕХ для docker-compose.yml (стенд или сервер пилота).

# pg_dump / pg_restore той же версии, что сервер базы (16), — для резервных копий с проверкой восстановления.
# Берутся из официального образа PostgreSQL вместе со своими библиотеками (в отдельной папке, не трогают систему).
FROM postgres:16-bookworm AS pgclient
RUN mkdir -p /pgclient/bin /pgclient/lib \
 && cp /usr/lib/postgresql/16/bin/pg_dump /usr/lib/postgresql/16/bin/pg_restore /pgclient/bin/ \
 && for l in $(ldd /pgclient/bin/* | awk '/=>/{print $3}' | sort -u); do \
      case "$(basename "$l")" in libc.so*|libm.so*|libresolv.so*|libpthread.so*|libdl.so*) ;; *) cp -L "$l" /pgclient/lib/ ;; esac; done

FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY --from=pgclient /pgclient /usr/lib/pgclient
RUN for b in pg_dump pg_restore; do \
      printf '#!/bin/sh\nLD_LIBRARY_PATH=/usr/lib/pgclient/lib exec /usr/lib/pgclient/bin/%s "$@"\n' "$b" > /usr/local/bin/$b && chmod +x /usr/local/bin/$b; done \
 && pg_dump --version && pg_restore --version
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["bash", "deploy/start.sh"]
