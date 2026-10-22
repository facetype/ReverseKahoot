-- Whether a quiz instance has been started by its host. The lobby is open while
-- this is false: join() accepts players. Once the host starts the game it flips
-- to true, the lobby closes and the host can move into the question loop.
-- Defaults to false so existing and newly created instances stay joinable.
-- Idempotent.

alter table public."QuizInstance"
  add column if not exists "isStarted" boolean not null default false;
