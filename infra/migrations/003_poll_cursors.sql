-- 003_poll_cursors.sql  (2026-04-24)
-- Generic key/value cursor store for polling workers.
-- Used by scripts/trades-poll.ts to remember the latest-seen timestamp per source
-- across restarts and multiple instances.
--
-- ASCII-only comments (see 002_universe.sql header for rationale).

CREATE TABLE IF NOT EXISTS poll_cursors (
  key         text PRIMARY KEY,
  last_seen   timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON poll_cursors TO trading_app;
