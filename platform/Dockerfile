# Образ приложения ЦЕХ для docker-compose.yml (стенд или сервер пилота).
FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["bash", "deploy/start.sh"]
