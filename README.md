# FreePBX Call Visualiser

Real-time call path visualiser for FreePBX / Asterisk, using the AMI (Asterisk Manager Interface).

## Architecture

```
Browser ──ws──▶ nginx (:8080)
                  │ /ws proxy_pass
                  ▼
             ami-proxy (:3000, internal)
                  │ TCP
                  ▼
             Asterisk AMI (:5038)
```

## Quick start

### 1. FreePBX: create an AMI user

In `/etc/asterisk/manager.conf` (or via FreePBX Admin → Asterisk Manager):

```ini
[admin]
secret = changeme
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.1/255.255.255.0   ; or your Docker host IP
read = all
write = all
```

Reload: `asterisk -rx "manager reload"`

### 2. Configure

```bash
cp .env.example .env
nano .env          # set AMI_HOST, AMI_USER, AMI_SECRET
```

### 3. Run

```bash
docker compose up -d
```

Open http://your-server:8080 in a browser.
Click **Connect** (leave host/port blank to use the built-in nginx proxy path).

### 4. Verify

```bash
docker compose logs -f         # watch all logs
docker compose logs ami-proxy  # proxy only
curl http://localhost:8080/health
```

## Security notes

- The AMI proxy port (3000) is **not** exposed externally — only nginx is public.
- For production, put nginx behind a reverse proxy with TLS (Caddy, Certbot, etc).
- Restrict the AMI `permit` to the Docker bridge network CIDR only.
- The FreePBX AMI user should be `read = all, write = none` unless you need to send actions.

## Updating

```bash
docker compose pull
docker compose up -d --build
```
