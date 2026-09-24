-- Public join code for a game session. Generated client-side (see
-- src/database/game-api.ts); the unique constraint is what guarantees no two
-- games share a code, and the client retries on a collision.
-- Nullable so existing rows without a code stay valid. Idempotent.

alter table public."GameHistory"
  add column if not exists "gameCode" varchar(6);

alter table public."GameHistory"
  drop constraint if exists "GameHistory_gameCode_key";

alter table public."GameHistory"
  add constraint "GameHistory_gameCode_key" unique ("gameCode");
