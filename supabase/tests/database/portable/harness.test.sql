begin;
-- pgTAP lives in the `extensions` schema, which is not on the test runner's
-- search_path. Every test file needs this line or plan()/ok() will not resolve.
set local search_path to extensions, public;

select plan(1);

select ok(true, 'pgTAP harness runs');

select * from finish();
rollback;
