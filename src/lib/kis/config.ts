export type KisEnv = "live" | "sandbox";

function readEnvFlag(): KisEnv {
  const raw = (process.env.KIS_ENV ?? "live").trim().toLowerCase();
  return raw === "sandbox" ? "sandbox" : "live";
}

export const KIS_ENV: KisEnv = readEnvFlag();

export const KIS_BASE_URL =
  KIS_ENV === "live"
    ? "https://openapi.koreainvestment.com:9443"
    : "https://openapivts.koreainvestment.com:29443";

export function requireCreds() {
  const appKey = process.env.KIS_APP_KEY?.trim();
  const appSecret = process.env.KIS_APP_SECRET?.trim();
  if (!appKey || !appSecret) {
    throw new Error(
      "KIS_APP_KEY / KIS_APP_SECRET가 .env.local에 설정되어 있지 않습니다.",
    );
  }
  return { appKey, appSecret };
}
