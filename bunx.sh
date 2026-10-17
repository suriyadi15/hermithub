#!/bin/sh
# Run bun inside the official image as the current user (no host install needed).
exec docker run --rm -i -u "$(id -u):$(id -g)" -e HOME=/tmp/home -e BUN_INSTALL_CACHE_DIR=/cache \
  -v bun-cache:/cache -v "$(cd "$(dirname "$0")" && pwd)":/app -w "/app/${BUN_SUBDIR:-}" ${BUN_DOCKER_ARGS:-} oven/bun:1-debian "$@"
