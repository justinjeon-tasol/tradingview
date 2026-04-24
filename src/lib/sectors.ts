/**
 * KOSPI 200 섹터 코드 → 한글 이름 매핑.
 *
 * 1~B 숫자·알파벳 코드는 KRX KOSPI 200 섹터 분류(건설/중공업/철강/화학/IT/금융/…)
 * 기준이며, 프로젝트 DB의 실제 샘플 종목명으로 검증 완료 (2026-04-24).
 *
 * 기존 수동 시드 (universe_expanded.json)의 한글 섹터명(반도체·항공·엔터 등)은
 * 매핑 없이 그대로 반환. 알 수 없는 단일 문자/숫자 코드는 "섹터 X"로 fallback.
 */

const KOSPI200_SECTOR_MAP: Record<string, string> = {
  "1": "건설",
  "2": "중공업·조선",
  "3": "철강",
  "4": "화학·에너지",
  "5": "IT",
  "6": "금융",
  "7": "필수소비재",
  "8": "경기소비재",
  "9": "산업재·운송",
  A: "헬스케어",
  B: "커뮤니케이션",
};

export function sectorLabel(raw: string | null | undefined): string {
  if (!raw) return "(미분류)";
  const trimmed = raw.trim();
  if (!trimmed) return "(미분류)";
  // 단일 문자/숫자 코드면 매핑, 아니면 (이미 한글인 경우) 그대로
  if (trimmed.length === 1 && KOSPI200_SECTOR_MAP[trimmed]) {
    return KOSPI200_SECTOR_MAP[trimmed]!;
  }
  if (trimmed.length === 1) {
    return `섹터 ${trimmed}`;
  }
  return trimmed;
}

/**
 * 그룹핑 순서 정하기용. 알려진 KOSPI200 코드는 IT 먼저 등의 관례 순서 적용.
 */
const SECTOR_ORDER: Record<string, number> = {
  IT: 1,
  금융: 2,
  헬스케어: 3,
  경기소비재: 4,
  필수소비재: 5,
  "화학·에너지": 6,
  "산업재·운송": 7,
  "중공업·조선": 8,
  건설: 9,
  철강: 10,
  커뮤니케이션: 11,
};

export function sectorSortWeight(label: string): number {
  return SECTOR_ORDER[label] ?? 100;
}
