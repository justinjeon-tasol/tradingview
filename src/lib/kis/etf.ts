import { KIS_BASE_URL, requireCreds } from "./config";
import { getAccessToken } from "./token";

export type EtfComponent = {
  code: string;
  name: string;
  price: number;
  prevChange: number;
  prevChangeSign: string;
  prevChangePct: number;
};

type KisEtfComponentRow = {
  stck_shrn_iscd: string;
  hts_kor_isnm: string;
  stck_prpr: string;
  prdy_vrss: string;
  prdy_vrss_sign: string;
  prdy_ctrt: string;
};

type KisEtfComponentResponse = {
  rt_cd: string;
  msg_cd?: string;
  msg1?: string;
  output1?: unknown;
  output2?: KisEtfComponentRow[];
};

/**
 * ETF 구성종목 조회 (TR FHKST121600C0).
 *
 * KOSPI 200 대리로 KODEX 200(069500) 사용 가능.
 * 응답은 200개 전후의 구성종목 목록. 각 종목의 현재가/전일대비도 포함.
 */
export async function fetchEtfComponents(etfCode: string): Promise<EtfComponent[]> {
  const token = await getAccessToken();
  const { appKey, appSecret } = requireCreds();

  const url = new URL(
    `${KIS_BASE_URL}/uapi/etfetn/v1/quotations/inquire-component-stock-price`,
  );
  url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J");
  url.searchParams.set("FID_INPUT_ISCD", etfCode);
  url.searchParams.set("FID_COND_SCR_DIV_CODE", "11216");

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: "FHKST121600C0",
      custtype: "P",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `KIS ETF components HTTP ${res.status}: ${res.statusText} ${text}`,
    );
  }

  const body = (await res.json()) as KisEtfComponentResponse;
  if (body.rt_cd !== "0") {
    throw new Error(
      `KIS ETF components error: rt_cd=${body.rt_cd} msg_cd=${body.msg_cd ?? ""} msg=${body.msg1 ?? ""}`,
    );
  }

  const rows = body.output2 ?? [];
  return rows
    .filter((r) => r.stck_shrn_iscd && r.hts_kor_isnm)
    .map((r) => ({
      code: r.stck_shrn_iscd.padStart(6, "0"),
      name: r.hts_kor_isnm.trim(),
      price: Number(r.stck_prpr),
      prevChange: Number(r.prdy_vrss),
      prevChangeSign: r.prdy_vrss_sign,
      prevChangePct: Number(r.prdy_ctrt),
    }));
}
