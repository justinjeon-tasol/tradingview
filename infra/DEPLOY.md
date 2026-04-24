# stockchart.jeons.kr 배포 런북

VM1(arm-server-01)은 이미 호스트 nginx가 80/443을 점유하고 있고 trading.jeons.kr (Supabase)를 서빙 중. Caddy 추가 대신 **기존 nginx에 stockchart.jeons.kr server block 추가**하는 방식으로 배포.

최종 URL: `https://stockchart.jeons.kr` (공개 차트 + 검색, `/trade/*`는 Tailscale만)

## 아키텍처

```
Internet :443
    │
    ▼
[호스트 nginx] ─ trading.jeons.kr → Supabase Kong (127.0.0.1:8000)
    │
    └─ stockchart.jeons.kr → tv1-web (127.0.0.1:3000)
                                │
                                ▼
                     [docker network]
                     tv1-pg / tv1-redis
```

## 사전 요구

- VM1에 Docker + docker compose + nginx + certbot 설치·운영 중 (확인됨)
- tv1-pg, tv1-redis 가동 중 · infra/.env 설정 완료
- `stockchart.jeons.kr` A 레코드가 VM1 공용 IP(213.35.117.73) 지향 (dnszi.com에 등록됨)
- git repo `justinjeon-tasol/tradingview` 접근 가능

## 1. Windows에서 git push

로컬 변경사항 커밋·푸시:
```powershell
git add .
git commit -m "feat: deploy stack — Dockerfile, nginx server block, docker-compose tv1-web"
git push origin main
```

## 2. VM1에서 코드 받기 (최초 1회)

```bash
ssh arm-server-01
cd ~
git clone https://github.com/justinjeon-tasol/tradingview.git trading-app
cd trading-app

cp infra/.env.example infra/.env
vim infra/.env
# - POSTGRES_PASSWORD / TRADING_APP_PASSWORD / REDIS_PASSWORD:
#     기존 tv1-pg 설치 당시 ~/trading-infra/.env 값 복사 (없으면 비밀번호 매니저)
# - KIS_APP_KEY / KIS_APP_SECRET: Windows .env.local 동일 값
# - KIS_ENV=live
# - CRON_SHARED_SECRET: openssl rand -hex 32 로 새로 생성
# - DB_BIND_HOST / REDIS_BIND_HOST: 기존 값 유지
```

## 3. tv1-web 컨테이너 빌드·기동

```bash
cd ~/trading-app/infra
sudo docker compose up -d --build tv1-web

# 상태 확인
sudo docker compose ps
sudo docker compose logs --tail 50 tv1-web
```

초기 빌드 3~7분 소요 (ARM64 Node 20 alpine). 완료 후 로컬 접속 검증:
```bash
curl -sSI http://127.0.0.1:3000/ | head -3
# HTTP/1.1 200 OK  (또는 308 if any redirect)
curl -sS 'http://127.0.0.1:3000/api/candles?symbol=005930&interval=5m' | head -c 200
```

## 4. nginx stockchart server block 초기 배치 + certbot 인증서 발급

### 4a. Bootstrap HTTP-only 설정 (certbot 검증용)

certbot이 HTTP-01 챌린지를 통과해야 인증서가 나옴. 일단 80 포트만 도는 최소 설정 투입.

```bash
# 임시 bootstrap 설정
sudo tee /etc/nginx/sites-available/stockchart.jeons.kr > /dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name stockchart.jeons.kr;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 200 "stockchart bootstrap ok\n";
        add_header Content-Type text/plain;
    }
}
NGINX

sudo ln -s /etc/nginx/sites-available/stockchart.jeons.kr /etc/nginx/sites-enabled/
sudo mkdir -p /var/www/html
sudo nginx -t && sudo systemctl reload nginx

# 80 포트로 접속되는지 외부에서 확인 (DNS + iptables + OCI Security List 모두 통과하는지)
curl -sS http://stockchart.jeons.kr/
# → "stockchart bootstrap ok" 가 나와야 정상.
# 실패 시: iptables에 80 없거나 OCI SL이 80 차단. 7번 참조.
```

### 4b. Let's Encrypt 인증서 발급

```bash
sudo certbot certonly --webroot \
  -w /var/www/html \
  -d stockchart.jeons.kr \
  --non-interactive --agree-tos \
  -m admin@jeons.kr

# 발급 완료 확인
sudo ls -la /etc/letsencrypt/live/stockchart.jeons.kr/
# fullchain.pem, privkey.pem 존재해야 정상
```

### 4c. Full HTTPS 설정으로 교체

```bash
sudo cp ~/trading-app/infra/nginx-stockchart.conf /etc/nginx/sites-available/stockchart.jeons.kr
sudo nginx -t && sudo systemctl reload nginx
```

## 5. 최종 동작 확인

브라우저에서 https://stockchart.jeons.kr 접속 — 차트 앱이 뜨고 자물쇠(TLS) OK.

로컬 검증:
```bash
curl -sSI https://stockchart.jeons.kr/ | head -5
curl -sS  https://stockchart.jeons.kr/api/candles?symbol=005930&interval=5m | head -c 200
```

## 6. 업데이트 배포 플로우 (이후)

Windows에서 push → VM1 pull + 재빌드만.

```powershell
git add . && git commit -m "..." && git push
```
```bash
cd ~/trading-app
git pull
cd infra
sudo docker compose up -d --build tv1-web
# DB/Redis/nginx는 그대로
```

## 7. 방화벽 (이미 열려있을 가능성 높음 — trading.jeons.kr이 현재 443 서빙 중이므로)

trading.jeons.kr이 동작 중이면 80/443은 이미 통과 상태. 점검만:

```bash
# VM1 iptables
sudo iptables -L INPUT -n --line-numbers | grep -E ' (80|443)'

# OCI Security List (콘솔에서 확인):
#   VCN stock-vcn → Default Security List → Ingress에
#   22, 9443 외에 80, 443이 0.0.0.0/0 허용돼 있는지
```

80/443 이미 허용돼 있으면 7번 skip, 없으면 아래:
```bash
sudo iptables -A INPUT -p tcp --dport 80  -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

OCI 콘솔에서도 Ingress 2개(TCP 80, TCP 443) 추가.

## 트러블슈팅

**4a에서 `curl http://stockchart.jeons.kr` 실패**
- DNS 아직 전파 안 됨 — `nslookup stockchart.jeons.kr 8.8.8.8`
- OCI Security List에 80 없음 → §7 참조
- iptables에 80 없음 → §7 참조

**certbot 실패 "challenge failed"**
- 80 포트가 외부에서 도달 가능해야 함. 4a에서 외부 curl이 성공했으면 정상 발급.
- 재시도: `sudo certbot certonly --webroot -w /var/www/html -d stockchart.jeons.kr --force-renewal`

**tv1-web healthcheck 실패**
- DATABASE_URL에 `tv1-pg:5432` (도커 내부 호스트명)가 맞는지 확인.
- `sudo docker compose logs tv1-web` 에서 postgres 연결 에러 확인.
- tv1-pg가 같은 docker compose 스택에 있는지 `sudo docker compose ps`.

**nginx reload 실패 "SSL certificate not found"**
- 4b 아직 안 돌린 상태에서 4c로 바로 점프하면 발생. 순서 지키기.

**"502 Bad Gateway" on https://stockchart.jeons.kr**
- tv1-web 컨테이너 다운 → `sudo docker compose ps`, `sudo docker compose logs tv1-web`
- tv1-web이 `127.0.0.1:3000`으로 바인드됐는지: `sudo ss -tlnp | grep 3000`
