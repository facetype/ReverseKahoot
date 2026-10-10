-- Quiz instances expire 24 hours after creation, regardless of lobby activity.
create extension if not exists pg_cron with schema pg_catalog;

create index if not exists "QuizInstance_createdAt_idx"
  on public."QuizInstance" ("createdAt");

-- createdAt stores a UTC timestamp without time zone. Make the cutoff explicit
-- so expiration does not depend on the cron session's time zone.
-- Reusing the job name updates its schedule/command rather than duplicating it.
select cron.schedule(
  'expire-quiz-instances',
  '* * * * *',
  $$
    delete from public."QuizInstance"
    where "createdAt" <= (now() at time zone 'UTC') - interval '24 hours';
  $$
);
