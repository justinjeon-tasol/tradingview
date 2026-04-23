#!/usr/bin/env python3
"""scripts/diagnose_pykrx.py

pykrx API 진단: KRX 로그인 → 지수 목록 조회 → KOSPI200 이름 조회 → 구성종목 조회 trace.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.split("#", 1)[0].strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            if key and key not in os.environ:
                os.environ[key] = value


_repo_root = Path(__file__).resolve().parents[1]
_load_dotenv(_repo_root / ".env.local")

try:
    from pykrx import stock
except ImportError:
    print("pykrx not installed.", file=sys.stderr)
    sys.exit(1)

DATE = "20241230"

print("=" * 60)
print(f"[diagnose_pykrx] date={DATE}")
print(f"[diagnose_pykrx] KRX_ID set: {bool(os.environ.get('KRX_ID'))}")
print(f"[diagnose_pykrx] KRX_PW set: {bool(os.environ.get('KRX_PW'))}")
print("=" * 60)

print("\n--- 1. pykrx version ---")
try:
    import pykrx as _pk
    print(f"pykrx {_pk.__version__}")
except Exception as e:
    print(f"failed: {e}")

print("\n--- 2. KOSPI 계열 지수 목록 ---")
try:
    indices = stock.get_index_ticker_list(DATE, "KOSPI")
    print(f"총 {len(indices)}개")
    for i, t in enumerate(indices[:20]):
        try:
            name = stock.get_index_ticker_name(t)
        except Exception as e:
            name = f"<err: {e}>"
        print(f"  {t} — {name}")
    if len(indices) > 20:
        print(f"  ... +{len(indices) - 20} more")
except Exception as e:
    print(f"failed: {type(e).__name__}: {e}")

print("\n--- 3. KOSPI200 (1028) 이름 확인 ---")
try:
    name = stock.get_index_ticker_name("1028")
    print(f"  1028 → {name}")
except Exception as e:
    print(f"failed: {type(e).__name__}: {e}")

print("\n--- 4. 구성종목 조회 (deposit_file) ---")
try:
    result = stock.get_index_portfolio_deposit_file(DATE, "1028")
    print(f"  type={type(result).__name__} len={len(result) if hasattr(result, '__len__') else 'n/a'}")
    if hasattr(result, "__len__") and len(result) > 0:
        print(f"  first 10: {result[:10]}")
    else:
        print(f"  empty/none: {result}")
except Exception as e:
    print(f"failed: {type(e).__name__}: {e}")

print("\n--- 5. 다른 가능한 함수 이름 scan ---")
candidates = [name for name in dir(stock) if any(
    kw in name.lower() for kw in ("portfolio", "component", "deposit", "member"))]
print(f"  {candidates}")

print("\n=" * 6 + " done " + "=" * 60)
