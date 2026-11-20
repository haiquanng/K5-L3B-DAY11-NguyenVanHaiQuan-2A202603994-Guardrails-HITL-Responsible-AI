#!/usr/bin/env bash
# Guardrail Arena — chạy backend + web, tuỳ chọn mở Cloudflare quick tunnel.
#   scripts/arena.sh          # chỉ chạy local: http://127.0.0.1:3011
#   scripts/arena.sh public   # thêm link công khai https://*.trycloudflare.com
#   scripts/arena.sh reset    # xoá lịch sử tấn công + bảng xếp hạng (cần chạy trước khi start)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${1:-}" == "reset" ]]; then
  rm -f arena_data/attempts.jsonl && echo "Đã xoá arena_data/attempts.jsonl"
  exit 0
fi

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

.venv/bin/python src/web_api.py &
pids+=($!)

( cd web && { [[ -d .next ]] || npm run build; } && npm run start ) &
pids+=($!)

echo "Đợi backend nạp agent (NeMo mất ~10-20s)…"
for _ in $(seq 1 60); do
  curl -s 127.0.0.1:8011/health | grep -q '"red_advance":{"ready":true' && break
  sleep 1
done
echo "Local: http://127.0.0.1:3011"

if [[ "${1:-}" == "public" ]]; then
  echo "Mở Cloudflare tunnel — link công khai sẽ in ra bên dưới (dòng *.trycloudflare.com)."
  cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3011 &
  pids+=($!)
fi
wait
