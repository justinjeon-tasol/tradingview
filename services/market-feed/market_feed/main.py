"""APScheduler 엔트리포인트.

Phase 1: 크론 등록만 해두고 실제 수집 함수는 placeholder.
Phase 2: placeholder를 pykrx/yfinance/KIS 실호출로 교체.
"""

from __future__ import annotations

import logging
import signal
import sys

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from .config import LOG_LEVEL, TIMEZONE
from .db import close_pool
from .fetchers import credit_balance, flows_daily, halt_check, shorting

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("market_feed")


def build_scheduler() -> BlockingScheduler:
    scheduler = BlockingScheduler(timezone=TIMEZONE)

    # 평일 16:30 KST — 일간 수급
    scheduler.add_job(
        flows_daily.run,
        CronTrigger(day_of_week="mon-fri", hour=16, minute=30),
        id="flows_daily",
        replace_existing=True,
    )

    # 평일 17:00 KST — 공매도 잔고
    scheduler.add_job(
        shorting.run,
        CronTrigger(day_of_week="mon-fri", hour=17, minute=0),
        id="shorting",
        replace_existing=True,
    )

    # 월요일 18:00 KST — 신용잔고 (주간)
    scheduler.add_job(
        credit_balance.run,
        CronTrigger(day_of_week="mon", hour=18, minute=0),
        id="credit_balance",
        replace_existing=True,
    )

    # 장중 30분 간격 — 거래정지 감지
    scheduler.add_job(
        halt_check.run,
        CronTrigger(day_of_week="mon-fri", hour="9-15", minute="0,30"),
        id="halt_check",
        replace_existing=True,
    )

    return scheduler


def main() -> None:
    scheduler = build_scheduler()

    def shutdown(*_):
        logger.info("shutdown signal received")
        scheduler.shutdown(wait=False)
        close_pool()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    logger.info("market-feed started — timezone=%s", TIMEZONE)
    for job in scheduler.get_jobs():
        logger.info("  registered job: id=%s trigger=%s", job.id, job.trigger)

    scheduler.start()


if __name__ == "__main__":
    main()
