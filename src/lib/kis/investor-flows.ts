/**
 * TR_ID: FHPTJ04160001 — 종목별 투자자매매동향(일별)
 *
 * 주의:
 *   - 실전 도메인 전용 (모의투자 미지원)
 *   - 장 종료 후(16:30 KST+) 조회 권장
 *   - 거래대금 필드(`*_pbmn`)는 "백만원" 단위. 응답 파싱 시 × 1,000,000 필수.
 *
 * URL 경로는 KIS 공식 엑셀에서 절삭 — portal에서 최종 확인 후 조정 가능.
 * 현재 best-guess: /uapi/domestic-stock/v1/quotations/investor-trade-by-date
 */

import { KIS_BASE_URL, KIS_ENV, requireCreds } from "./config";
import { getAccessToken } from "./token";

type InvestorFlowRow = {
  stck_bsop_date: string;
  stck_clpr: string;
  acml_vol: string;
  acml_tr_pbmn: string;

  frgn_ntby_qty: string;
  frgn_ntby_tr_pbmn: string;
  frgn_reg_ntby_qty: string;
  frgn_reg_ntby_pbmn: string;
  frgn_nreg_ntby_qty: string;
  frgn_nreg_ntby_pbmn: string;

  prsn_ntby_qty: string;
  prsn_ntby_tr_pbmn: string;
  orgn_ntby_qty: string;
  orgn_ntby_tr_pbmn: string;

  scrt_ntby_qty: string;
  scrt_ntby_tr_pbmn: string;
  ivtr_ntby_qty: string;
  ivtr_ntby_tr_pbmn: string;
  pe_fund_ntby_vol: string;
  pe_fund_ntby_tr_pbmn: string;
  bank_ntby_qty: string;
  bank_ntby_tr_pbmn: string;
  insu_ntby_qty: string;
  insu_ntby_tr_pbmn: string;
  mrbn_ntby_qty: string;
  mrbn_ntby_tr_pbmn: string;
  fund_ntby_qty: string;
  fund_ntby_tr_pbmn: string;
  etc_ntby_qty: string;
  etc_ntby_tr_pbmn: string;
  etc_orgt_ntby_vol: string;
  etc_orgt_ntby_tr_pbmn: string;
  etc_corp_ntby_vol: string;
  etc_corp_ntby_tr_pbmn: string;
};

type InvestorFlowsResponse = {
  rt_cd: string;
  msg_cd: string;
  msg1: string;
  output1?: unknown;
  output2?: InvestorFlowRow[];
};

export type FlowRecord = {
  date: string;
  code: string;

  close_price: number;
  volume: number;
  value: number;

  foreign_net_qty: number;
  foreign_net_value: number;
  institution_net_qty: number;
  institution_net_value: number;
  individual_net_qty: number;
  individual_net_value: number;

  foreign_reg_net_qty: number;
  foreign_reg_net_value: number;
  foreign_nreg_net_qty: number;
  foreign_nreg_net_value: number;

  inst_securities_net_value: number;
  inst_trust_net_value: number;
  inst_privfund_net_value: number;
  inst_bank_net_value: number;
  inst_insurance_net_value: number;
  inst_merbank_net_value: number;
  inst_pension_net_value: number;
  inst_other_net_value: number;
  etc_corp_net_value: number;
};

const MILLION = 1_000_000;

function n(raw: string | undefined | null): number {
  if (raw == null) return 0;
  const v = parseInt(String(raw).replace(/,/g, "").trim(), 10);
  return Number.isFinite(v) ? v : 0;
}

function nMil(raw: string | undefined | null): number {
  return n(raw) * MILLION;
}

function fmtDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

export async function fetchInvestorFlowsDaily(params: {
  code: string;
  date: string;
  trCont?: string;
}): Promise<{ records: FlowRecord[]; trCont: string | null }> {
  if (KIS_ENV !== "live") {
    throw new Error("FHPTJ04160001 requires KIS_ENV=live (모의투자 미지원)");
  }

  const token = await getAccessToken();
  const { appKey, appSecret } = requireCreds();

  const url = new URL(
    `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/investor-trade-by-date`,
  );
  url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J");
  url.searchParams.set("FID_INPUT_ISCD", params.code);
  url.searchParams.set("FID_INPUT_DATE_1", params.date);
  url.searchParams.set("FID_ORG_ADJ_PRC", "");
  url.searchParams.set("FID_ETC_CLS_CODE", "1");

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: "FHPTJ04160001",
      custtype: "P",
      tr_cont: params.trCont ?? "",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `KIS flows HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`,
    );
  }

  const nextTrCont = res.headers.get("tr_cont");
  const body = (await res.json()) as InvestorFlowsResponse;
  if (body.rt_cd !== "0") {
    throw new Error(
      `KIS flows error rt_cd=${body.rt_cd} msg_cd=${body.msg_cd} msg=${body.msg1}`,
    );
  }

  const rows = body.output2 ?? [];
  const records: FlowRecord[] = rows.map((r) => ({
    date: fmtDate(r.stck_bsop_date),
    code: params.code,

    close_price: n(r.stck_clpr),
    volume: n(r.acml_vol),
    value: nMil(r.acml_tr_pbmn),

    foreign_net_qty: n(r.frgn_ntby_qty),
    foreign_net_value: nMil(r.frgn_ntby_tr_pbmn),
    institution_net_qty: n(r.orgn_ntby_qty),
    institution_net_value: nMil(r.orgn_ntby_tr_pbmn),
    individual_net_qty: n(r.prsn_ntby_qty),
    individual_net_value: nMil(r.prsn_ntby_tr_pbmn),

    foreign_reg_net_qty: n(r.frgn_reg_ntby_qty),
    foreign_reg_net_value: nMil(r.frgn_reg_ntby_pbmn),
    foreign_nreg_net_qty: n(r.frgn_nreg_ntby_qty),
    foreign_nreg_net_value: nMil(r.frgn_nreg_ntby_pbmn),

    inst_securities_net_value: nMil(r.scrt_ntby_tr_pbmn),
    inst_trust_net_value: nMil(r.ivtr_ntby_tr_pbmn),
    inst_privfund_net_value: nMil(r.pe_fund_ntby_tr_pbmn),
    inst_bank_net_value: nMil(r.bank_ntby_tr_pbmn),
    inst_insurance_net_value: nMil(r.insu_ntby_tr_pbmn),
    inst_merbank_net_value: nMil(r.mrbn_ntby_tr_pbmn),
    inst_pension_net_value: nMil(r.fund_ntby_tr_pbmn),
    inst_other_net_value:
      nMil(r.etc_ntby_tr_pbmn) + nMil(r.etc_orgt_ntby_tr_pbmn),
    etc_corp_net_value: nMil(r.etc_corp_ntby_tr_pbmn),
  }));

  return {
    records,
    trCont:
      nextTrCont && ["N", "M"].includes(nextTrCont.trim().toUpperCase())
        ? nextTrCont.trim().toUpperCase()
        : null,
  };
}
