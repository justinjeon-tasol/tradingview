FROM python:3.12-slim

WORKDIR /app

# 빌드 의존성 (psycopg/yfinance 일부 휠용)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential \
      libpq-dev \
      tzdata \
 && rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Seoul

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

COPY market_feed/ ./market_feed/

# 컨테이너 stdin 불필요, logs는 stdout
ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "market_feed.main"]
