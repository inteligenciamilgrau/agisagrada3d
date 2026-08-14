#!/usr/bin/env bash
# ============================================================
#  Setup do servidor do jogo no Oracle Cloud (Ubuntu 24.04)
#  Uso:  sudo bash setup.sh
#  Depois de rodar, o jogo fica em  https://SEU-DOMINIO
# ============================================================
set -euo pipefail

# ---------- CONFIG (EDITE ANTES DE RODAR) ----------
DOMAIN="seujogo.duckdns.org"      # seu domínio grátis do duckdns (sem https://)
EMAIL="voce@email.com"            # usado pelo Let's Encrypt (certificado HTTPS)
REPO="https://github.com/saboracaiteria/cs.git"
PORT=3000                         # porta interna do node (não precisa mudar)
# ----------------------------------------------------

echo "==> [1/7] Atualizando o sistema..."
sudo apt update -y && sudo apt upgrade -y

echo "==> [2/7] Instalando Node.js 20..."
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi
node -v

echo "==> [3/7] Instalando nginx + certbot (HTTPS grátis)..."
sudo apt install -y nginx certbot python3-certbot-nginx

echo "==> [4/7] Clonando o jogo..."
sudo mkdir -p /srv && sudo chown "$USER" /srv
cd /srv
if [ ! -d cs ]; then
  git clone "$REPO" cs
fi
cd cs
git pull --ff-only || true
npm install --omit=dev

echo "==> [5/7] Apontando o cliente para este servidor (só na VM)..."
if [ -f src/config.js ]; then
  sed -i "s#wsUrl: 'wss://[^']*'#wsUrl: 'wss://$DOMAIN/ws'#" src/config.js
  echo "    wsUrl agora: $(grep wsUrl src/config.js)"
fi

echo "==> [6/7] Criando o serviço (systemd) e iniciando..."
sudo tee /etc/systemd/system/cs.service >/dev/null <<SERVICE
[Unit]
Description=Jogo CS-Like (HTTP + WebSocket)
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/srv/cs
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
Environment=PORT=$PORT

[Install]
WantedBy=multi-user.target
SERVICE
sudo systemctl daemon-reload
sudo systemctl enable --now cs
sleep 3
sudo systemctl is-active cs

echo "==> [7/7] Configurando nginx (proxy HTTPS -> localhost:$PORT)..."
sudo cp "$(dirname "$0")/nginx.conf" /etc/nginx/sites-available/cs
sudo sed -i "s/__DOMAIN__/$DOMAIN/g; s/__PORT__/$PORT/g" /etc/nginx/sites-available/cs
sudo ln -sf /etc/nginx/sites-available/cs /etc/nginx/sites-enabled/cs
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo "==> Emitindo certificado HTTPS (Let's Encrypt)..."
sudo certbot --nginx -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive --redirect

echo ""
echo "======================================================"
echo " ✅ PRONTO! Jogo no ar em:  https://$DOMAIN"
echo "    Status:    sudo systemctl status cs"
echo "    Logs:      sudo journalctl -u cs -f"
echo "    Atualizar: bash /srv/cs/deploy/oracle/deploy.sh"
echo "======================================================"
