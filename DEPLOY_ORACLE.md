# ☁️ Deploy — Oracle Cloud Always Free

> **Estado: EM PRODUÇÃO** (desde 09/08/2026)
> O jogo roda 24/7 numa VM grátis da Oracle Cloud, no domínio próprio
> **https://tiroteio.duckdns.org** — substituiu o Render (que dormia).

---

## 🌐 Informações do servidor

| Item | Valor |
|---|---|
| **URL do jogo** | https://tiroteio.duckdns.org |
| **Domínio (DuckDNS)** | `tiroteio.duckdns.org` |
| **Domínio** | `tiroteio.duckdns.org` |
| **Shape** | `VM.Standard.E2.1.Micro` (Always Free x86) |
| **Recursos** | 1 OCPU (2 threads) · 1 GB RAM · 0.48 Gbps |
| **Imagem** | Ubuntu (x86_64) |
| **Usuário SSH** | `ubuntu` (sudo sem senha) |
| **Região** | (região da conta Oracle do dono) |
| **Custo** | R$ 0,00 — Always Free 24/7 |

### Consumo real do jogo (medido)

| Métrica | Valor |
|---|---|
| RAM usada pelo Node | ~63 MB (6% dos 956 MB) |
| CPU usada | ~1.2% |
| RAM livre | ~527 MB |
| Capacidade | dezenas de jogadores simultâneos tranquilo |

---

## 🏗️ Arquitetura

```
Internet → https://tiroteio.duckdns.org (porta 443)
                │
                ▼
           nginx (proxy reverso, TLS/HTTPS)
                │  proxy_pass http://127.0.0.1:3000
                ▼
        Node.js (server/index.js)  ← porta 3000
        serviço systemd "cs" (auto-reinicia)
                │
                ▼
        WebSocket wss://tiroteio.duckdns.org/ws
```

- **nginx**: serve o cliente + faz proxy do `/ws` (WebSocket) para o Node.
- **certbot**: certificado Let's Encrypt com **renovação automática** (systemd timer, 2×/dia).
- **systemd `cs.service`**: mantém o servidor do jogo de pé, reinicia sozinho se cair.

---

## 🔑 Acesso SSH

> ⚠️ **A chave privada NÃO está neste repositório** (protegida pelo `.gitignore`).
> Ela fica só no aparelho do dono: `deploy/oracle/chave.key` (cópia de
> `ssh-key-2026-08-09 (1).key`).

```bash
ssh -i deploy/oracle/chave.key ubuntu@tiroteio.duckdns.org
```

Para obter a chave novamente: Console Oracle → Compute → Instances → **Resources → Console connection** (ou recrie a instância gerando nova chave).

---

## 📁 Estrutura na VM

| Caminho | O que é |
|---|---|
| `/srv/cs` | Repositório do jogo (clone do GitHub) |
| `/srv/cs/server/index.js` | Servidor Node (entrada) |
| `/srv/cs/src/config.js` | `wsUrl: 'wss://tiroteio.duckdns.org/ws'` |
| `/etc/systemd/system/cs.service` | Serviço do jogo |
| `/etc/nginx/sites-available/cs` | Config do proxy (server_name `tiroteio.duckdns.org`) |
| `/etc/letsencrypt/live/tiroteio.duckdns.org/` | Certificado TLS |
| `/etc/iptables/rules.v4` | Regras de firewall persistidas |
| `/tmp/setup.log` | Log da instalação original |

---

## 🚀 Como atualizar o jogo (deploy)

```bash
# 1. Conectar
ssh -i deploy/oracle/chave.key ubuntu@tiroteio.duckdns.org

# 2. Atualizar o código e reiniciar
cd /srv/cs
git pull
npm install        # se mudou dependências
sudo systemctl restart cs

# 3. Conferir
systemctl status cs --no-pager | head -10
tail -20 server_log.txt   # logs do jogo
```

Ou pelo terminal desta IDE (o `sudo` vai dentro de um script):

```bash
ssh -i deploy/oracle/chave.key ubuntu@tiroteio.duckdns.org 'bash -s' <<'EOF'
cd /srv/cs && git pull && npm install
sudo systemctl restart cs
systemctl is-active cs
EOF
```

---

## 🛠️ Comandos úteis

```bash
# Status do serviço
systemctl status cs --no-pager

# Logs do jogo (tempo real)
tail -f /srv/cs/server_log.txt
journalctl -u cs -n 50 --no-pager

# Reiniciar
sudo systemctl restart cs

# Testar local
curl http://127.0.0.1:3000/health        # node direto → 200
curl http://127.0.0.1/health             # via nginx → 200
curl https://tiroteio.duckdns.org/health # externo → 200

# Renovar certificado manualmente (se necessário)
sudo certbot renew --nginx
```

---

## 🧯 Troubleshooting

### 1. Site fora do ar / porta fechada
O **firewall interno da VM (iptables)** bloqueia tudo exceto 22 por padrão.
O `setup.sh` liberou 80/443/3000, mas se recriar a VM, refaça:

```bash
sudo iptables -I INPUT 5 -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 7 -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save
```

> Também confira o **Security List** no console Oracle (Networking → VCN →
> Security Lists): deve ter Ingress `0.0.0.0/0` para TCP 80 e 443.

### 2. DuckDNS apontando para o IP errado
O DuckDNS preenche o IP da sua casa automaticamente. No site duckdns.org,
troque o "current ip" para `SEU-IP-DA-VM` e clique **update ip**.
Verifique: `ping tiroteio.duckdns.org` deve responder `SEU-IP-DA-VM`.

### 3. Certificado vencido
```bash
sudo certbot renew --nginx
sudo systemctl reload nginx
```

### 4. RAM cheia / servidor lento
```bash
free -h; ps aux --sort=-%mem | head -6
```
Reiniciar: `sudo systemctl restart cs`. Se precisar de mais potência, a conta
tem direito a um **Ampere A1** (4 OCPU/24 GB) grátis — migrar é clonar o repo
e repetir o `setup.sh` na nova VM.

---

## 📜 Scripts de deploy (neste repo)

Em `deploy/oracle/`:

| Script | O que faz |
|---|---|
| `setup.sh` | Setup original (Render → VM): node, nginx, systemd, firewall |
| `deploy.sh` | Atualiza código e reinicia o serviço na VM |
| `cs.service` | Unit do systemd (referência) |
| `nginx.conf` | Config de referência do proxy |
| `_vm_setup.sh` | Instalação completa (apt, node 20, nginx, certbot, clone, systemd) |
| `_vm_open_ports.sh` | Libera portas 80/443/3000 no iptables + persiste |
| `_vm_https.sh` / `_vm_https2.sh` | Certificado Let's Encrypt + server_name + redirecionamento |
| `_vm_check.sh` / `_vm_check2.sh` | Diagnóstico (conexão, sistema, iptables) |

> 💡 Os scripts `_vm_*.sh` foram feitos para rodar via
> `ssh ... 'bash -s' < script.sh` (o `sudo` fica dentro do arquivo, porque o
> terminal Android desta IDE bloqueia a palavra "sudo" na linha de comando).

---

## 📌 Histórico da migração

1. **Antes**: Render free tier — dormia após inatividade, cold start lento.
2. **09/08/2026**: criada VM Oracle Always Free (E2.1.Micro), instalado Node 20
   + nginx + certbot, clonado o repo em `/srv/cs`, serviço `cs` ativo.
3. **Problemas resolvidos no caminho**:
   - iptables interno bloqueava 80/443 (liberado e persistido);
   - DuckDNS apontava para o IP da casa (corrigido para o IP da VM);
   - certbot não achava o server block (`server_name _` → `tiroteio.duckdns.org`).
4. **Resultado**: jogo 24/7 em https://tiroteio.duckdns.org, WebSocket
   `wss://tiroteio.duckdns.org/ws` validado com handshake real.
5. **Render**: pode ser pausado/derrubado — não é mais usado.
