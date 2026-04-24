import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

declare global {
  // eslint-disable-next-line no-var
  var __tradingSql: Sql | undefined;
}

function createClient(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Configure it in .env.local (dev) or docker env (prod).",
    );
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

function getSql(): Sql {
  if (!globalThis.__tradingSql) {
    globalThis.__tradingSql = createClient();
  }
  return globalThis.__tradingSql;
}

/**
 * Lazy Proxy — actual postgres() client creation is deferred until the first
 * template-call or property access. This lets `next build` import the module
 * without DATABASE_URL set (build phase page-data-collection doesn't run SQL).
 */
export const sql = new Proxy((() => {}) as unknown as Sql, {
  apply(_target, thisArg, args) {
    const client = getSql() as unknown as (...a: unknown[]) => unknown;
    return Reflect.apply(client, thisArg, args);
  },
  get(_target, prop) {
    const client = getSql() as unknown as Record<PropertyKey, unknown>;
    const value = client[prop as keyof typeof client];
    return typeof value === "function"
      ? (value as (...a: unknown[]) => unknown).bind(client)
      : value;
  },
}) as Sql;
