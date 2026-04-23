import { promises as fs } from "node:fs";
import path from "node:path";
import { KIS_BASE_URL, KIS_ENV, requireCreds } from "./config";

type CachedToken = {
  accessToken: string;
  expiresAt: number;
  env: string;
};

const CACHE_PATH = path.join(process.cwd(), ".kis-token-cache.json");
const TOKEN_SAFETY_WINDOW_MS = 60 * 1000;

let memoryCache: CachedToken | null = null;
let inflight: Promise<string> | null = null;

async function readDiskCache(): Promise<CachedToken | null> {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as CachedToken;
    if (
      typeof parsed.accessToken === "string" &&
      typeof parsed.expiresAt === "number" &&
      parsed.env === KIS_ENV
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeDiskCache(token: CachedToken) {
  await fs.writeFile(CACHE_PATH, JSON.stringify(token, null, 2), "utf-8");
}

function readEnvToken(): CachedToken | null {
  const accessToken = process.env.KIS_ACCESS_TOKEN?.trim();
  if (!accessToken) return null;

  const expiresAtRaw = process.env.KIS_ACCESS_TOKEN_EXPIRES_AT?.trim();
  const expiresAt = expiresAtRaw ? Date.parse(expiresAtRaw) : NaN;

  if (!Number.isFinite(expiresAt)) {
    return {
      accessToken,
      expiresAt: Date.now() + 60 * 60 * 1000,
      env: KIS_ENV,
    };
  }

  return { accessToken, expiresAt, env: KIS_ENV };
}

function isFresh(token: CachedToken | null): token is CachedToken {
  return !!token && token.expiresAt - TOKEN_SAFETY_WINDOW_MS > Date.now();
}

async function issueNewToken(): Promise<CachedToken> {
  const { appKey, appSecret } = requireCreds();

  const res = await fetch(`${KIS_BASE_URL}/oauth2/tokenP`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: appKey,
      appsecret: appSecret,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `KIS token issue failed: ${res.status} ${res.statusText} ${text}`,
    );
  }

  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error_code?: string;
  };

  if (!body.access_token) {
    throw new Error(
      `KIS token response missing access_token: ${JSON.stringify(body)}`,
    );
  }

  const expiresInMs = (body.expires_in ?? 60 * 60 * 23) * 1000;
  const token: CachedToken = {
    accessToken: body.access_token,
    expiresAt: Date.now() + expiresInMs,
    env: KIS_ENV,
  };

  await writeDiskCache(token).catch(() => {
    /* disk cache best-effort */
  });
  return token;
}

export async function getAccessToken(): Promise<string> {
  if (isFresh(memoryCache)) return memoryCache.accessToken;

  const envToken = readEnvToken();
  if (isFresh(envToken)) {
    memoryCache = envToken;
    return envToken.accessToken;
  }

  const diskToken = await readDiskCache();
  if (isFresh(diskToken)) {
    memoryCache = diskToken;
    return diskToken.accessToken;
  }

  if (!inflight) {
    inflight = issueNewToken()
      .then((t) => {
        memoryCache = t;
        return t.accessToken;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
