#!/usr/bin/env python3
"""scripts/parse_kospi_mst.py

KIS kospi_code.mst 파일을 파싱해 KOSPI200 등 지수 편입 종목을 JSON으로 추출.

파일 구조:
  Each record = 60 bytes (코드+이름) + 228 bytes (플래그들) + newline
  - [ 0: 9) 단축코드 (9 bytes, space-padded)
  - [ 9:21) 표준코드 (12 bytes, ISIN)
  - [21:61) 한글종목명 (40 bytes, CP949 encoded)
  - [61:   ) 228 bytes metadata (KOSPI200 flag, 시총규모, 업종 등)

KIS 공식 샘플 기준 metadata 레이아웃:
  [0:2]  그룹코드 (ST=주식, ET=ETF, EN=ETN...)
  [2:3]  시가총액규모 (1=대형, 2=중형, 3=소형)
  [3:7]  지수업종대분류
  [7:11] 지수업종중분류
  [11:15] 지수업종소분류
  [15:16] 제조업
  [16:17] 저유동성
  [17:18] 지배구조지수
  [18:20] KOSPI200 섹터업종 (2 bytes — 0이면 비편입, 1~9 섹터코드면 편입)
  [20:21] KOSPI100
  [21:22] KOSPI50
  [22:23] KRX
  ...

사용:
  python scripts/parse_kospi_mst.py --input data/kis/kospi_code.mst --output data/seed/kospi200_from_mst.json
  python scripts/parse_kospi_mst.py --dump-sample   # 몇 개 종목 flag 구조 덤프
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def decode_record(raw_bytes: bytes) -> dict:
    """Parse a single record. Returns dict with all fields."""
    if len(raw_bytes) < 60 + 228:
        return {}

    code = raw_bytes[0:9].decode("ascii", errors="ignore").strip()
    std_code = raw_bytes[9:21].decode("ascii", errors="ignore").strip()
    # name: 40 bytes CP949 encoded Korean
    name_bytes = raw_bytes[21:61]
    try:
        name = name_bytes.decode("cp949", errors="ignore").strip()
    except Exception:
        name = name_bytes.decode("latin-1", errors="ignore").strip()

    meta = raw_bytes[61:]
    # meta field slicing (best-guess positions per KIS spec)
    group_code = meta[0:2].decode("ascii", errors="ignore").strip()
    cap_size = meta[2:3].decode("ascii", errors="ignore").strip()
    industry_major = meta[3:7].decode("ascii", errors="ignore").strip()
    industry_mid = meta[7:11].decode("ascii", errors="ignore").strip()
    industry_minor = meta[11:15].decode("ascii", errors="ignore").strip()
    manufacturer = meta[15:16].decode("ascii", errors="ignore").strip()
    low_liquidity = meta[16:17].decode("ascii", errors="ignore").strip()
    governance = meta[17:18].decode("ascii", errors="ignore").strip()
    kospi200_sector = meta[18:19].decode("ascii", errors="ignore").strip()
    kospi100 = meta[19:20].decode("ascii", errors="ignore").strip()
    kospi50 = meta[20:21].decode("ascii", errors="ignore").strip()
    krx = meta[21:22].decode("ascii", errors="ignore").strip()

    # KOSPI200 편입 판정: kospi200_sector가 '0' 또는 비어있으면 비편입
    # 1~9 또는 A~Z 섹터코드면 편입
    in_kospi200 = bool(kospi200_sector) and kospi200_sector not in ("0", " ", "")

    return {
        "code": code,
        "std_code": std_code,
        "name": name,
        "group_code": group_code,  # ST/ET/EN/etc
        "cap_size": cap_size,  # 1/2/3
        "industry_major": industry_major,
        "industry_mid": industry_mid,
        "industry_minor": industry_minor,
        "manufacturer": manufacturer,
        "low_liquidity": low_liquidity,
        "kospi200_sector": kospi200_sector,
        "in_kospi200": in_kospi200,
        "kospi100": kospi100 == "Y",
        "kospi50": kospi50 == "Y",
        "krx": krx == "Y",
    }


def dump_sample_records(records: list[dict], known_codes: list[str]):
    """Show full flag breakdown for known stocks to verify parsing."""
    by_code = {r["code"]: r for r in records if r.get("code")}
    print("\n=== 검증용 샘플 (알려진 종목의 플래그) ===")
    for code in known_codes:
        r = by_code.get(code)
        if not r:
            print(f"  {code}: NOT FOUND")
            continue
        print(f"\n  {code} {r['name']}")
        print(f"    group={r['group_code']!r} cap={r['cap_size']!r}")
        print(f"    kospi200_sector={r['kospi200_sector']!r} → in_kospi200={r['in_kospi200']}")
        print(f"    kospi100={r['kospi100']} kospi50={r['kospi50']} krx={r['krx']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        default="data/kis/kospi_code.mst",
        help="path to kospi_code.mst",
    )
    parser.add_argument(
        "--output",
        default="data/seed/kospi200_from_mst.json",
        help="output JSON path",
    )
    parser.add_argument(
        "--dump-sample",
        action="store_true",
        help="parse + dump known stock flags for verification, do NOT write output",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    input_path = Path(args.input) if Path(args.input).is_absolute() else repo_root / args.input

    with input_path.open("rb") as f:
        raw = f.read()

    lines = raw.split(b"\n")
    records: list[dict] = []
    for line in lines:
        if len(line) < 288:
            continue
        rec = decode_record(line)
        if rec.get("code"):
            records.append(rec)

    print(f"[parse_kospi_mst] parsed {len(records)} records")
    groups = {}
    for r in records:
        g = r["group_code"] or "?"
        groups[g] = groups.get(g, 0) + 1
    print(f"[parse_kospi_mst] group breakdown: {groups}")

    # Sample dump — Samsung 005930, SK하이닉스 000660, and some smaller cap
    known = ["005930", "000660", "005380", "035420", "012330"]
    if args.dump_sample:
        dump_sample_records(records, known)
        return

    # Filter to KOSPI200 members (in_kospi200 = True AND group_code = ST)
    kospi200 = [
        r
        for r in records
        if r["in_kospi200"] and r["group_code"] == "ST"
    ]
    print(f"[parse_kospi_mst] KOSPI200 members (in_kospi200 flag): {len(kospi200)}")

    # Also show 시가총액규모 별 stock count
    caps = {}
    for r in records:
        if r["group_code"] == "ST":
            c = r["cap_size"] or "?"
            caps[c] = caps.get(c, 0) + 1
    print(f"[parse_kospi_mst] 시가총액규모 breakdown (ST only): {caps}")

    # Output format: universe-load 호환
    stocks = [
        {
            "code": r["code"],
            "name": r["name"],
            "market": "KOSPI",
            "sector": r["kospi200_sector"] or None,
            "tags": [],
        }
        for r in kospi200
    ]

    output_path = Path(args.output) if Path(args.output).is_absolute() else repo_root / args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {
            "source": "kis:kospi_code.mst",
            "extracted_at": input_path.stat().st_mtime,
            "count": len(stocks),
        },
        "stocks": stocks,
    }
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"[parse_kospi_mst] wrote {len(stocks)} stocks → {output_path}")


if __name__ == "__main__":
    main()
