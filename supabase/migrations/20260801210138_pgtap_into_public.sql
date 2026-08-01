-- Superseded, retained only to keep local and remote migration history aligned.
--
-- This attempted to relocate pgTAP with `create extension ... with schema
-- public`. It does not relocate an already-installed extension: pgTAP remained
-- in `extensions`. The actual fix is the following migration, which grants
-- USAGE on that schema. Do not delete this file — it is applied remotely.
drop extension if exists pgtap;
create extension if not exists pgtap with schema extensions;
