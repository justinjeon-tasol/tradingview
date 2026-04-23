#!/usr/bin/env python3
"""scripts/fetch_kospi200.py

One-shot fetcher: KRX 지수(KOSPI200 / KOSDAQ150) 구성종목을 pykrx로 조회해
universe-load 호환 JSON(data/seed/<index>.json)으로 저장.

Usage:
    python scripts/fetch_kospi200.py
    python scripts/fetch_kospi200.py --date 20240401
    python scripts/fetch_kospi200.py --index kosdaq150
    python scripts/fetch_kospi200.py --output data/seed/kospi200_2024H1.json

Install:
    pip install pykrx

Output format (universe-load.ts와 호환):
    { "stocks": [ { "code": "005930", "name": "삼성전자",
                    "market": "KOSPI", "sector": null, "tags": [] }, ... ] }

리밸런싱 스냅샷 관리 팁:
    * 매년 6월/12월 지수 리밸런싱 후 재실행해서 추가/삭제된 종목 반영
    * 구버전 보존하려면 --output 으로 날짜 박은 파일명 사용
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """프로젝트 루트 .env.local에서 환경변수 로드 (python-dotenv 없이 minimal 파서).

    shell에 이미 설정된 값은 덮어쓰지 않음 (shell 우선).
    """
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            # inline comment 제거 (단, quoted 값 안의 # 보존을 위해 간이 처리)
            value = value.split("#", 1)[0].strip()
            # 감싸는 따옴표 제거
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            if key and key not in os.environ:
                os.environ[key] = value


_repo_root = Path(__file__).resolve().parents[1]
_load_dotenv(_repo_root / ".env.local")


try:
    from pykrx import stock
except ImportError:
    print("pykrx not installed. Run: pip install pykrx", file=sys.stderr)
    sys.exit(1)


# pykrx 지수 코드 → (index_code, 시장, 기본 출력 파일명)
INDEX_TABLE = {
    "kospi200":  ("1028", "KOSPI",  "kospi200.json"),
    "kosdaq150": ("2203", "KOSDAQ", "kosdaq150.json"),
    "kospi":     ("1001", "KOSPI",  "kospi_all.json"),
    "kosdaq":    ("2001", "KOSDAQ", "kosdaq_all.json"),
}


def find_latest_trading_date(index_code: str, start: datetime, max_lookback: int = 14) -> str:
    """가장 최근 거래일의 YYYYMMDD 반환 (start 포함, 주말/공휴일 스킵).

    pykrx는 휴일 요청 시 빈 리스트 반환하므로 유효한 데이터가 나오는 날짜를 찾는다.
    """
    for delta in range(0, max_lookback):
        cand = (start - timedelta(days=delta)).strftime("%Y%m%d")
        try:
            members = stock.get_index_portfolio_deposit_file(cand, index_code)
        except Exception:
            continue
        if members:
            return cand
    raise RuntimeError(
        f"{max_lookback}일 이내에 {index_code} 구성종목 데이터를 가진 거래일을 찾지 못했습니다."
    )


def fetch(index_key: str, date_str: str | None, output: Path) -> None:
    if index_key not in INDEX_TABLE:
        print(f"unknown index key: {index_key}. available: {list(INDEX_TABLE)}", file=sys.stderr)
        sys.exit(2)
    index_code, market, _default_filename = INDEX_TABLE[index_key]

    if date_str is None:
        date_str = find_latest_trading_date(index_code, datetime.now())

    print(f"[fetch_kospi200] {index_key} ({index_code}) as of {date_str}")

    codes = stock.get_index_portfolio_deposit_file(date_str, index_code)
    print(f"[fetch_kospi200] {len(codes)} members")

    stocks: list[dict] = []
    for i, code in enumerate(codes, start=1):
        try:
            name = stock.get_market_ticker_name(code)
        except Exception as e:
            print(f"  WARN {code}: name lookup failed ({e})", file=sys.stderr)
            name = code
        stocks.append(
            {
                "code": code,
                "name": name,
                "market": market,
                "sector": None,
                "tags": [],
            }
        )
        if i % 50 == 0:
            print(f"  resolved names: {i}/{len(codes)}")

    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {
            "index": index_key,
            "index_code": index_code,
            "market": market,
            "as_of_date": date_str,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            "count": len(stocks),
        },
        "stocks": stocks,
    }
    with output.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"[fetch_kospi200] wrote {len(stocks)} stocks → {output}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch KRX index constituents via pykrx.")
    parser.add_argument(
        "--index",
        default="kospi200",
        choices=sorted(INDEX_TABLE.keys()),
        help="index key (default: kospi200)",
    )
    parser.add_argument(
        "--date",
        default=None,
        help="YYYYMMDD. 생략 시 최근 거래일 자동 탐색.",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="output path. 생략 시 data/seed/<index>.json.",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    if args.output:
        output = Path(args.output)
    else:
        _, _, default_filename = INDEX_TABLE[args.index]
        output = repo_root / "data" / "seed" / default_filename

    fetch(args.index, args.date, output)


if __name__ == "__main__":
    main()
