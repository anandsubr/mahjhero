begin;
select plan(1);

select ok(true, 'pgTAP harness runs');

select * from finish();
rollback;
