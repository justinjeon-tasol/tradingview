"""공통 설정 (환경변수 로딩)."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# 개발 환경: 프로젝트 루트 .env.local 로드. 컨테이너에선 이미 환경변수로 주입됨.
ROOT = Path(__file__).resolve().parents[3]  # .../tradingview-1
load_dotenv(ROOT / ".env.local", override=False)


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"환경변수 {name}가 비어있습니다")
    return value


DATABASE_URL = _require("DATABASE_URL")
LOG_LEVEL = os.environ.get("FEED_LOG_LEVEL", "info").upper()

# 스케줄러 기본 타임존
TIMEZONE = "Asia/Seoul"
