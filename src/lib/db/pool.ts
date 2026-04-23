import postgres from "postgres";

declare global {
  var __tradingSql: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set in .env.local");
  }
  return postgres(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: true,
    types: {
      bigint: postgres.BigInt,
    },
  });
}

export const sql = globalThis.__tradingSql ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__tradingSql = sql;
}
