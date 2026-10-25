#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if [ "${1:-}" != "" ] && [ "$1" != "--app-only" ]; then
  echo "用法：$0 [--app-only]" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "未检测到 Docker，请先安装 Docker。" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "未检测到 Docker Compose 插件。" >&2
  exit 1
fi

mkdir -p data

if [ ! -f .env ]; then
  umask 077
  {
    echo "DOMAIN=luckylu.top"
    printf 'SIGNUP_CODE='
    openssl rand -hex 24
  } > .env
fi

chown -R 1000:1000 data
chmod 700 data
for db_file in data/*.sqlite*; do
  if [ -f "$db_file" ]; then
    chmod 600 "$db_file"
  fi
done
if [ "${1:-}" = "--app-only" ]; then
  docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d --build lulu-tide
else
  docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d --build
fi

echo "Lucky Lu 容器已启动。"
docker compose --env-file .env -f deploy/docker-compose.prod.yml ps
