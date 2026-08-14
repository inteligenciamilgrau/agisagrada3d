#!/usr/bin/env bash
# ============================================================
#  Atualização do servidor no Oracle (git pull + restart)
#  Uso:  bash deploy.sh
# ============================================================
set -euo pipefail
cd /srv/cs

echo "==> Buscando atualizações do git..."
git checkout -- .
git pull --ff-only

echo "==> Instalando dependências..."
npm install --omit=dev

echo "==> Reaplicando wsUrl para este servidor..."
DOMAIN="tiroteio.duckdns.org"
sed -i "s#wsUrl: 'wss://[^']*'#wsUrl: 'wss://$DOMAIN/ws'#" src/config.js

echo "==> Reiniciando o serviço..."
sudo systemctl restart cs
sleep 2
sudo systemctl is-active cs

echo "✅ Atualizado! Logs: sudo journalctl -u cs -f"
