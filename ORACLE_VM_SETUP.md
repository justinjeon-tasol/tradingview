# Oracle Cloud VM 진행 상황 및 접속 가이드

> 작성일: 2026-04-23
> 계정: justinjeon@gmail.com / 리전: 싱가폴 (ap-singapore-1)

## 계정 정보

- **계정 유형**: Pay As You Go (업그레이드 완료)
- **홈 리전**: 싱가폴 (ap-singapore-1) — 변경 불가
- **Always Free 한도**:
  - ARM Ampere A1: 총 4 OCPU / 24GB RAM
  - AMD VM.Standard.E2.1.Micro: 2개
  - 블록 스토리지: 총 200GB
  - 아웃바운드 트래픽: 월 10TB

## 안전장치 (과금 방지)

- **Budget Alert** (`safety-budget`): 월 $1 한도, 50/80/100% 이메일 알림
- **Compartment Quota** (`always-free-quota`): Always Free 한도 하드 리밋
  - ARM A1 core: 4 / memory: 24GB
  - AMD E2 core: 2
  - Block storage: 200GB / 볼륨 2개

## VM1 — arm-server-01

### 기본 정보

| 항목 | 값 |
|------|-----|
| 상태 | 실행 중 |
| 공용 IPv4 | `213.35.117.73` |
| OCPU | 2 |
| RAM | 12 GB |
| Boot Volume | 100 GB |
| Shape | VM.Standard.A1.Flex (ARM Ampere) |
| OS | Ubuntu 24.04 LTS (aarch64) |
| 호스트명 | arm-server-01 |
| CPU | ARM Neoverse-N1 (2코어) |
| VCN | stock-vcn |
| Subnet | public subnet-stock-vcn |

### 설치/설정 완료 항목

- 시스템 업데이트 (`apt upgrade`, 재부팅 완료)
- 타임존: `Asia/Seoul`
- Docker 27.x (ARM64 이미지 정상 동작 검증)
- 필수 도구: `htop vim git curl wget unzip net-tools ufw fail2ban`
- iptables 영구화 (`iptables-persistent` + `netfilter-persistent`)
- Portainer CE 실행 중 (포트 9443)

### iptables 수신 포트

| 포트 | 용도 | 상태 |
|------|------|------|
| 22 | SSH | ACCEPT |
| 80 | HTTP | ACCEPT |
| 443 | HTTPS | ACCEPT |
| 9443 | Portainer | ACCEPT |

### OCI Security List (stock-vcn Default)

| 포트/프로토콜 | 소스 | 설명 |
|--------------|------|------|
| 22/TCP | 0.0.0.0/0 | SSH |
| 9443/TCP | 0.0.0.0/0 | Portainer Web UI |
| ICMP | 0.0.0.0/0, 10.0.0.0/16 | 네트워크 진단 |

> **참고**: 80/443은 아직 OCI Security List에 추가 안 됨.
> 웹서비스 외부 공개 시 Ingress Rule 추가 필요.

### 실행 중인 컨테이너

- `portainer` — portainer/portainer-ce:latest, 포트 9443, 항상 재시작

## VM2 — 미생성

- Always Free 한도 중 **2 OCPU / 12GB / 100GB 남아있음**
- 필요 시 싱가폴에서 추가 ARM 인스턴스 생성 가능
- 또는 AMD VM.Standard.E2.1.Micro 2개 (각 1 OCPU / 1GB) 생성 가능
- 용도 아이디어:
  - 개발/테스트 환경 분리
  - 리버스 프록시 전용
  - DB 전용 (VM1과 역할 분리)

## SSH 접속 방법

### 키 파일 위치 (Windows)

- 개인키: `C:\Users\justi\.ssh\oracle_key` ← 접속에 필요
- 공개키: `C:\Users\justi\.ssh\oracle_key.pub` ← VM에 등록됨

### 기본 접속 (Windows PowerShell / Windows Terminal)

```powershell
ssh -i "C:\Users\justi\.ssh\oracle_key" ubuntu@213.35.117.73
```

### 첫 접속 시

```
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

→ `yes` 입력 (서버 지문을 known_hosts에 저장)

### 권한 에러 해결 (필요 시)

```powershell
icacls "C:\Users\justi\.ssh\oracle_key" /inheritance:r
icacls "C:\Users\justi\.ssh\oracle_key" /grant:r "$env:USERNAME`:R"
```

### SSH Config로 단축키 만들기 (권장)

`C:\Users\justi\.ssh\config` 파일 생성/편집:

```ssh-config
Host arm-server-01
    HostName 213.35.117.73
    User ubuntu
    IdentityFile C:\Users\justi\.ssh\oracle_key
    ServerAliveInterval 60
```

이후 접속이 한 줄로 끝납니다:

```powershell
ssh arm-server-01
```

### 파일 복사 (SCP)

```powershell
# 로컬 → VM1
scp -i "C:\Users\justi\.ssh\oracle_key" <로컬파일> ubuntu@213.35.117.73:/home/ubuntu/

# VM1 → 로컬
scp -i "C:\Users\justi\.ssh\oracle_key" ubuntu@213.35.117.73:/home/ubuntu/<파일> .

# SSH Config 사용 시
scp <로컬파일> arm-server-01:/home/ubuntu/
```

## 주요 접속 URL

| 서비스 | URL | 계정 |
|--------|-----|------|
| Portainer | https://213.35.117.73:9443 | admin / (본인 설정) |
| OCI 콘솔 | https://cloud.oracle.com | justinjeon@gmail.com |

> 브라우저 접속 시 인증서 경고 → "고급" → "안전하지 않음으로 이동"

## 자주 쓰는 명령어

### 시스템 상태

```bash
# 메모리 / 디스크 / CPU
free -h
df -h
htop

# 네트워크 포트
sudo ss -tlnp

# iptables
sudo iptables -L INPUT -n --line-numbers
```

### Docker

```bash
# 실행 중 컨테이너
docker ps

# 전체 컨테이너 (종료된 것 포함)
docker ps -a

# 이미지 목록
docker images

# 컨테이너 재시작
docker restart <name>

# 로그 확인
docker logs <name> -f --tail 100

# Compose 스택 목록
docker compose ls
```

### 시스템 관리

```bash
# 재부팅
sudo reboot

# 서비스 종료 (과금 X, 한도 복귀 X)
# OCI 콘솔에서 VM → 중지

# 업데이트
sudo apt update && sudo apt upgrade -y
```

## 다음 단계 후보

### 단기 (내일~)

- [ ] Tailscale 설치 (VM1 + Windows 개발 머신) — 프라이빗 네트워크
- [ ] TimescaleDB + Redis 스택 배포 (차트 데이터용)
  - `docker-compose.yml` in `infra/`
  - 포트: 5432 (Postgres), 6379 (Redis)
  - Tailscale 통해서만 접근 → 공용 노출 X
- [ ] `.env.local`의 `DATABASE_URL`을 VM1으로 교체
- [ ] Route Handler: DB 우선 조회, 캐시 미스 시 KIS API → upsert
- [ ] 차트 무한 스크롤 (prepend) 연결

### 중기

- [ ] 도메인 연결 + Cloudflare DNS
- [ ] Let's Encrypt 무료 HTTPS (Traefik 또는 Nginx Proxy Manager)
- [ ] 자동 백업 (DB 덤프 → OCI Object Storage 20GB 무료)
- [ ] VM2 생성 검토

### 장기

- [ ] 모니터링 (Uptime Kuma, Grafana)
- [ ] 로깅 (Loki / Promtail)
- [ ] CI/CD (GitHub Actions → VM1 자동 배포)

## 비상 대응

### SSH 접속이 안 될 때

1. OCI 콘솔에서 VM 상태 확인 (실행 중인가?)
2. 공용 IP가 바뀌었나? (VM 재생성 시 바뀜)
3. OCI Security List에 22 포트 열려있나?
4. VM 내부 iptables에 22 포트 있나?
5. 최후 수단: OCI 콘솔의 **클라우드 셸(Cloud Shell)** 또는 **시리얼 콘솔 연결** 사용

### 과금 발생 시

1. Budget Alert 이메일 확인 (어떤 리소스?)
2. OCI 콘솔 → 청구 및 비용 관리 → **비용 분석**
3. 과금 리소스 즉시 삭제
4. Always Free 범위로 복귀

### Portainer 비밀번호 분실 시

```bash
# VM1에서 실행 - 컨테이너 재생성하여 초기화
docker stop portainer
docker rm portainer
docker volume rm portainer_data
docker volume create portainer_data
docker run -d -p 9443:9443 --name portainer --restart=always \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data \
  portainer/portainer-ce:latest
# 5분 안에 https://213.35.117.73:9443 접속하여 새 계정 생성
```

> **주의**: 위 방법은 Portainer 설정을 전부 초기화합니다.
> 기존 컨테이너/이미지/볼륨은 Docker 레벨에 있어서 유지됩니다.
