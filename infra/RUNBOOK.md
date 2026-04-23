# Infra Runbook — VM1 (arm-server-01)

Tailscale 프라이빗 네트워크 + TimescaleDB + Redis 배포 절차.
VM1은 **TradingView-1 + 대출계산 SaaS 공유 서버**로 설계됨. DB 인스턴스는 공유하되
DB/유저 레벨로 격리해 상호 접근을 차단한다.

각 단계 완료 후 `[ ]`를 `[x]`로 바꿔가며 진행.

> ⚠️ **SQL 파일 파이프 주의 (PowerShell)**
> Windows PowerShell 5.1의 `Get-Content`는 UTF-8 BOM이 없는 파일을 시스템 기본 인코딩
> (한국어 Windows는 CP949)으로 읽어 비-ASCII 바이트를 변형시킬 수 있습니다. 이 때문에
> SQL 마이그레이션에 한글 주석이 있으면 파이프 도중 바이트가 깨져 컬럼이 누락될 수 있습니다.
>
> 대응책 3가지:
> 1. **마이그레이션 SQL은 ASCII only로 작성** (이 저장소 정책).
> 2. 파이프 시 **`Get-Content -Encoding UTF8`** 명시:
>    ```powershell
>    Get-Content -Encoding UTF8 infra/migrations/002_universe.sql | ssh arm-server-01 "sudo docker exec -i tv1-pg psql -U postgres -d trading"
>    ```
> 3. 또는 파일을 VM1에 scp로 보내고 VM1 bash에서 `docker exec ... < file.sql`로 실행.

## 멀티 워크로드 설계 요약

- **Postgres 인스턴스 1개** (tv1-pg) 공유, DB별로 완전 격리
  - `trading` DB — TradingView-1 전용, 유저 `trading_app`
  - `loanapp` DB — SaaS 전용, 유저 `loanapp_app` (Phase 2에서 추가)
  - 각 DB에 PUBLIC CONNECT 차단, 타 유저 접근 REVOKE
  - superuser `postgres`는 운영/마이그레이션 전용 (앱에서 직접 사용 금지)
- **Redis는 워크로드별 별도 컨테이너**
  - `tv1-redis` — TradingView-1 전용 (지금 배포)
  - `saas-redis` — SaaS 필요 시 Phase 2에서 별도 컨테이너
- **포트는 127.0.0.1 또는 Tailscale IP 바인딩만** — 0.0.0.0 금지
- **리소스 캡**: 12GB VM에서 TV1 스택은 최대 5GB (pg 4GB + redis 1GB) 사용, 나머지는 SaaS 몫

## 0. 사전 확인

- [ ] VM1 SSH 접속 가능: `ssh -i "C:\Users\justi\.ssh\oracle_key" ubuntu@213.35.117.73`
- [ ] Windows에 Tailscale 설치하지 않은 상태 (설치 예정)

## 1. Tailscale 설치 — VM1

VM1에서 실행:

```bash
# Tailscale 설치
curl -fsSL https://tailscale.com/install.sh | sh

# 데몬 시작 + 가입 (첫 실행 시 auth URL 출력됨)
sudo tailscale up --ssh

# 출력된 https://login.tailscale.com/... URL을 브라우저에서 열어 로그인
# (이미 계정 있으면 해당 계정으로, 없으면 Google/GitHub 등으로 신규 생성)

# 확인: 100.x.x.x IP 출력돼야 함
tailscale ip -4
```

- [ ] VM1 Tailscale IP 확인: `100.____________` (이후 단계에서 사용)

## 2. Tailscale 설치 — Windows 개발 머신

1. https://tailscale.com/download/windows 에서 인스톨러 다운로드
2. 설치 후 **VM1과 동일한 Tailscale 계정**으로 로그인
3. PowerShell에서 확인:
   ```powershell
   tailscale ip -4
   tailscale status
   ```
- [ ] Windows에서 VM1의 Tailscale IP로 ping 되는지 확인: `ping 100.x.x.x`

## 3. iptables에 Tailscale 트래픽 허용 — VM1

VM1에서 실행:

```bash
# Tailscale 인터페이스로 들어오는 Postgres/Redis 트래픽 허용
sudo iptables -A INPUT -i tailscale0 -p tcp --dport 5432 -j ACCEPT
sudo iptables -A INPUT -i tailscale0 -p tcp --dport 6379 -j ACCEPT

# 영구화
sudo netfilter-persistent save

# 확인
sudo iptables -L INPUT -n --line-numbers | grep -E 'tailscale0|5432|6379'
```

- [ ] 5432 / 6379 규칙이 tailscale0 인터페이스로 ACCEPT 상태로 뜨는지 확인

> **OCI Security List는 건드릴 필요 없습니다** — 5432/6379는 공용 IP로 열지 않고 Tailscale 프라이빗 네트워크로만 접근할 것이므로.

## 4. infra 파일 VM1에 업로드

Windows에서:

```powershell
# 프로젝트 루트에서 실행
scp -i "C:\Users\justi\.ssh\oracle_key" -r infra ubuntu@213.35.117.73:/home/ubuntu/trading-infra
```

VM1에서:

```bash
cd ~/trading-infra
ls -la
# docker-compose.yml, init.sql, .env.example, RUNBOOK.md 보여야 함
```

## 5. 비밀번호 3종 생성 + .env 작성

VM1에서:

```bash
cd ~/trading-infra
cp .env.example .env

# 랜덤 비밀번호 3개 생성 (superuser / 앱유저 / redis)
POSTGRES_PW=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-32)
TRADING_APP_PW=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-32)
REDIS_PW=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-32)

# VM1 Tailscale IP 확인 후 DB_BIND_HOST에 넣기 (Windows에서 접속하려면 필수)
TS_IP=$(tailscale ip -4 | head -1)

cat > .env <<EOF
POSTGRES_PASSWORD=$POSTGRES_PW
TRADING_APP_PASSWORD=$TRADING_APP_PW
REDIS_PASSWORD=$REDIS_PW
DB_BIND_HOST=$TS_IP
REDIS_BIND_HOST=$TS_IP
EOF

cat .env   # 확인. Windows .env.local에도 이 값을 써야 함
```

- [ ] 3개 비밀번호 모두 안전한 곳(비밀번호 매니저)에 복사
- [ ] `DB_BIND_HOST`, `REDIS_BIND_HOST`에 VM1 Tailscale IP(100.x.x.x) 기록됨

## 6. 스택 실행

VM1에서:

```bash
cd ~/trading-infra
chmod +x init-roles.sh
sudo docker compose up -d

# 상태 확인
sudo docker compose ps
sudo docker compose logs --tail 40 timescaledb
sudo docker compose logs --tail 20 redis

# 초기화 로그에서 "[init-roles] trading_app role ready" 문구 확인
sudo docker compose logs timescaledb | grep -i "init-roles"

# 하이퍼테이블 + 테이블 확인 (superuser로)
sudo docker exec -it tv1-pg psql -U postgres -d trading -c "\dt"
sudo docker exec -it tv1-pg psql -U postgres -d trading -c "SELECT * FROM timescaledb_information.hypertables;"

# trading_app 유저 권한 확인 (앱이 실제 쓸 유저)
sudo docker exec -it tv1-pg psql -U postgres -d trading -c "\du trading_app"
```

- [ ] `candles_1m` 테이블 존재 + 하이퍼테이블 등록됨
- [ ] `trading_app` 유저 존재, superuser 아님
- [ ] `tv1-pg` / `tv1-redis` 둘 다 `Up (healthy)`

## 7. Windows에서 접속 테스트

PowerShell에서 (psql이 설치돼 있으면):

```powershell
# VM1 Tailscale IP를 100.x.x.x 자리에 넣기
$Env:PGPASSWORD="<step 5의 TRADING_APP_PASSWORD>"
psql -h 100.x.x.x -p 5432 -U trading_app -d trading -c "\dt"

# superuser로는 못 붙는 걸 의도한 건 아니지만, 앱 유저는 다른 DB 접근 불가해야 함
# Phase 2 후 loanapp DB 생기면 아래가 실패해야 정상:
# psql -h 100.x.x.x -U trading_app -d loanapp  # → "permission denied"
```

- [ ] Windows에서 VM1의 TimescaleDB에 `trading_app`으로 접속 성공
- [ ] `candles_1m` SELECT/INSERT 권한 확인

## 8. 앱 측 DATABASE_URL / REDIS_URL 교체

`D:\Project\tradingview-1\.env.local` 수정 (TRADING_APP_PASSWORD, REDIS_PASSWORD는 step 5에서 만든 값):

```
DATABASE_URL=postgres://trading_app:<TRADING_APP_PW>@100.x.x.x:5432/trading
REDIS_URL=redis://:<REDIS_PW>@100.x.x.x:6379
```

(기존 Supabase DATABASE_URL은 주석 처리하거나 삭제.)

- [ ] `.env.local` 업데이트 완료

## 9. 완료 — 다음 진행 (TradingView-1 앱 측)

- `src/lib/db/` (postgres 드라이버 + candle repo)
- Route Handler를 DB-first / KIS fallback으로 교체
- 차트 무한 스크롤 prepend (7일치)

---

## Phase 2: 대출계산 SaaS 스택 추가 절차

TradingView-1이 안정화된 후, 같은 VM1에 SaaS 앱을 올릴 때의 순서.

### P2-1. Postgres에 격리된 DB + 유저 생성

VM1에서 superuser로 접속해 실행:

```bash
# LOANAPP_APP_PASSWORD는 따로 생성
LOANAPP_APP_PW=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-32)
echo "LOANAPP_APP_PASSWORD=$LOANAPP_APP_PW"   # 비밀번호 매니저에 저장

# 새 DB + 유저 + 권한 격리
sudo docker exec -i tv1-pg psql -U postgres <<EOSQL
-- loanapp 전용 유저
CREATE ROLE loanapp_app WITH LOGIN PASSWORD '$LOANAPP_APP_PW';

-- loanapp DB 생성 (소유자는 loanapp_app)
CREATE DATABASE loanapp OWNER loanapp_app;

-- loanapp DB의 공용 접근 차단
REVOKE ALL ON DATABASE loanapp FROM PUBLIC;
REVOKE CONNECT ON DATABASE loanapp FROM PUBLIC;
GRANT CONNECT ON DATABASE loanapp TO loanapp_app;

-- 상호 접근 명시적 차단 (방어적)
REVOKE ALL ON DATABASE trading FROM loanapp_app;
REVOKE ALL ON DATABASE loanapp FROM trading_app;
EOSQL

# 확인: trading_app으로 loanapp DB 접속 시 permission denied 나와야 함
sudo docker exec -it tv1-pg psql -U trading_app -d loanapp
# → FATAL: permission denied for database "loanapp"  ← 정상
```

### P2-2. SaaS Redis (필요한 경우)

세션/rate-limit이 필요하면 별도 컨테이너로:

```yaml
# /opt/stacks/saas/docker-compose.yml (별도 스택)
services:
  saas-redis:
    image: redis:7-alpine
    container_name: saas-redis
    # 포트는 앱 컨테이너와 같은 네트워크에서만 공유, 호스트 바인딩 불필요
    mem_limit: 512m
    ...
```

### P2-3. 공개 HTTPS 노출 (Caddy 리버스 프록시)

SaaS는 회원제라도 public 웹 접근 필요. Caddy가 Traefik보다 설정 간단하고
Let's Encrypt 자동 갱신 내장.

```yaml
# /opt/stacks/edge/docker-compose.yml
services:
  caddy:
    image: caddy:2-alpine
    container_name: edge-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
```

```Caddyfile
# /opt/stacks/edge/Caddyfile
loans.example.com {
  reverse_proxy saas-app:3000
}
```

- OCI Security List: **80, 443만 추가로 열기.** 5432/6379는 계속 Tailscale만.
- DNS A 레코드를 VM1 공용 IP로 설정 후 Caddy 재시작 → 자동 HTTPS

### P2-4. 상호 격리 체크리스트

- [ ] `trading_app` 유저는 `loanapp` DB 접속 불가
- [ ] `loanapp_app` 유저는 `trading` DB 접속 불가
- [ ] `tv1-redis`와 `saas-redis`는 별도 컨테이너, 서로 네트워크 다름
- [ ] SaaS 공개 HTTPS는 80/443만 노출, DB/Redis는 Tailscale 전용 유지

---

## 트러블슈팅

- **VM1에서 `sudo tailscale up`이 auth URL을 안 보여줌** → 세션 끊고 다시 시도, 또는 `sudo tailscale logout && sudo tailscale up`
- **Windows에서 100.x로 ping 실패** → 양쪽 모두 Tailscale 로그인 돼있는지 `tailscale status`로 확인. 동일 tailnet인지 확인.
- **컨테이너가 `unhealthy`로 멈춤** → `sudo docker compose logs timescaledb`로 원인 확인. 흔한 원인: init.sql/init-roles.sh 문법 오류, 비밀번호 env 누락.
- **`init-roles.sh` Permission denied** → `chmod +x init-roles.sh` 후 `docker compose down && up -d`. 초기화 스크립트는 **볼륨이 비어있을 때만** 실행되므로 이미 초기화된 상태면 `docker compose down -v`로 볼륨까지 삭제 후 재시작 (개발 중에만).
- **trading_app 유저 비밀번호 변경이 필요** → VM1에서 `sudo docker exec -it tv1-pg psql -U postgres -c "ALTER ROLE trading_app WITH PASSWORD '새비번';"` 후 `.env.local` DATABASE_URL 업데이트.
- **ARM64 이미지 경고** → `timescale/timescaledb:latest-pg16`, `redis:7-alpine`, `caddy:2-alpine` 모두 multi-arch. 문제시 `--platform linux/arm64/v8` 명시.
