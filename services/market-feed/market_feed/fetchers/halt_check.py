"""거래정지 자동 감지 (장중 30분마다).

Phase 2에서 구현:
  - KIS inquire-price로 종목별 trading_status 체크
  - 'HALTED' 감지 시 symbols 테이블 갱신 + universe S→B 강등
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def run() -> None:
    logger.info("[halt_check] placeholder — Phase 2")
