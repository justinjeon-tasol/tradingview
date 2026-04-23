"""일간 수급 (외국인/기관/개인 순매수) — pykrx.

Phase 2에서 구현:
  from pykrx import stock
  df = stock.get_market_net_purchases_of_equities_by_ticker(...)
  → flows_daily 테이블에 upsert.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def run() -> None:
    logger.info("[flows_daily] placeholder — not implemented yet (Phase 2)")
