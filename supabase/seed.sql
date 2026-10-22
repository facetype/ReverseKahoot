-- Test data for the local Supabase stack. Runs after the migrations on
-- `supabase start` (first run) and on every `supabase db reset`. Never runs
-- against the live project.
--
-- Log in as host@test.local / password123 to host the sample quiz. Players
-- join anonymously from a second browser window with the game's join code.

-- Empty strings instead of NULL in the token columns: GoTrue fails to sign in
-- users whose token columns are NULL.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated', 'host@test.local',
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider": "email", "providers": ["email"]}', '{"userName": "TestHost"}',
  now(), now(), '', '', '', ''
);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  'email',
  '{"sub": "11111111-1111-1111-1111-111111111111", "email": "host@test.local", "email_verified": true}',
  now(), now(), now()
);
-- The Profile row comes from the on_auth_user_created trigger.

insert into public."Category" ("categoryId", "categoryName", "userId") overriding system value values
  (1, 'General knowledge', '11111111-1111-1111-1111-111111111111');

insert into public."Quiz" ("quizId", "userId", "categoryId", "quizTitle") overriding system value values
  (1, '11111111-1111-1111-1111-111111111111', 1, 'Test quiz');

insert into public."Question" ("questionId", "quizId", "questionText") overriding system value values
  (1, 1, 'What is the capital of France?'),
  (2, 1, 'How many legs does a spider have?'),
  (3, 1, 'Which planet is known as the Red Planet?');

insert into public."Answer" ("answerId", "questionId", "answerText", "isCorrect") overriding system value values
  (1, 1, 'Paris', true),
  (2, 1, 'Lyon', false),
  (3, 1, 'Marseille', false),
  (4, 1, 'Nice', false),
  (5, 2, '8', true),
  (6, 2, '6', false),
  (7, 2, '10', false),
  (8, 2, '4', false),
  (9, 3, 'Mars', true),
  (10, 3, 'Venus', false),
  (11, 3, 'Jupiter', false),
  (12, 3, 'Mercury', false);

insert into public."Hint" ("hintId", "questionId", "hintText", "hintCost") overriding system value values
  (1, 1, 'Home of the Eiffel Tower', 50),
  (2, 2, 'Same as an octopus', 50),
  (3, 3, 'Fourth from the sun', 100);

-- Explicit ids above do not advance the identity sequences, so move them past the seed
-- rows or the first quiz created in the app collides with them.
select setval('public."Category_categoryId_seq"', (select max("categoryId") from public."Category"));
select setval('public."Quiz_quizId_seq"', (select max("quizId") from public."Quiz"));
select setval('public."Question_questionId_seq"', (select max("questionId") from public."Question"));
select setval('public."Answer_answerId_seq"', (select max("answerId") from public."Answer"));
select setval('public."Hint_hintId_seq"', (select max("hintId") from public."Hint"));
