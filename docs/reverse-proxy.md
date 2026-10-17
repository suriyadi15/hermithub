# Remote access

The container listens on `127.0.0.1:8787` only. Pick one way to reach it from elsewhere. The dashboard
gives shell access, so always use HTTPS from the internet.

## Built-in HTTPS (Caddy)

For a server with a public IP and a domain pointing to it:

```bash
./install.sh --domain hub.example.com      # or set these in .env:
# COMPOSE_PROFILES=https
# HUB_DOMAIN=hub.example.com
# PUBLIC_ORIGIN=https://hub.example.com
docker compose up -d
```

Caddy gets a Let's Encrypt certificate and renews it. Ports 80 and 443 must be free and reachable.

## Your own reverse proxy

WebSockets (`/ws/…`) must be forwarded. Set `PUBLIC_ORIGIN` if the proxy changes the `Host` header.

Caddy:

```
hub.example.com {
	encode gzip zstd
	reverse_proxy 127.0.0.1:8787
}
```

nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name hub.example.com;
    # ssl_certificate ...;

    client_max_body_size 200m;   # file uploads

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 1d;
    }
}
```

If the proxy runs in another container, attach it to the hub's network or use `HUB_BIND=0.0.0.0` with a firewall.

## Cloudflare Tunnel

No open ports, and Cloudflare Access can add a second login (recommended):

```bash
cloudflared tunnel --url http://localhost:8787            # quick test
# or a named tunnel with ingress: service: http://localhost:8787
```

Set `PUBLIC_ORIGIN=https://<your-hostname>` in `.env`.

## Tailscale / VPN

Install Tailscale on the host and set `HUB_BIND` to the host's Tailscale IP (or `0.0.0.0` with a firewall),
or use `tailscale serve 8787`.

## SSH tunnel

From your computer:

```bash
ssh -L 8787:localhost:8787 user@server
```

Then open http://localhost:8787.
