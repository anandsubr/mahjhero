/*
 * Events, series, and tables.
 *
 * The shape follows the parent spec's data model with one change worth
 * naming: an occurrence does not "detach" from its series wholesale when a
 * host edits it. It records WHICH FIELDS were edited, in `overrides`, so a
 * host who moves one week to a different hall has changed the address and not
 * the schedule — a later change to the series' start time still reaches that
 * week.
 */

create type public.event_status as enum ('draft', 'published', 'cancelled');
create type public.skill_tier as enum
  ('beginner', 'intermediate', 'advanced', 'mixed');
create type public.series_frequency as enum
  ('weekly', 'biweekly', 'monthly_nth_weekday');

/*
 * The rule, never an instant.
 *
 * No timezone column: it reads `clubs.timezone`. Copying it here would mean a
 * club that corrects its timezone has to correct it again in every series,
 * and the two would eventually disagree.
 *
 * frequency, weekday, nth_week and starts_on are immutable in practice —
 * nothing in this schema stops an UPDATE, but no function offers one.
 * Changing the rhythm means ending this series and starting another, because
 * editing a rule in place requires cancelling occurrences on dates the old
 * rule produced, generating occurrences on dates the new one produces, and
 * then deciding what happens to a customised week stranded on a date that
 * exists in neither. That is a class of bug bought for an action a club takes
 * approximately never.
 */
create table public.event_series (
  id                   uuid primary key default gen_random_uuid(),
  club_id              uuid not null references public.clubs(id)
                         on delete cascade,
  title                text not null check (length(trim(title)) > 0),
  venue_id             uuid not null references public.venues(id),
  notes                text not null default '',
  frequency            public.series_frequency not null,
  weekday              smallint not null check (weekday between 0 and 6),
  nth_week             smallint check (nth_week = -1 or nth_week between 1 and 5),
  start_time           time not null,
  duration_minutes     int not null default 180
                         check (duration_minutes between 15 and 1440),
  table_count          int not null default 1
                         check (table_count between 1 and 20),
  starts_on            date not null,
  ends_on              date,
  materialized_through date,
  created_by           uuid not null references public.profiles(id),
  created_at           timestamptz not null default now(),

  -- nth_week is meaningful for exactly one frequency, and meaningless for
  -- the others. Letting it be set anyway would leave a value that reads as
  -- intent and is silently ignored.
  constraint event_series_nth_week_matches_frequency check (
    (frequency = 'monthly_nth_weekday') = (nth_week is not null)
  ),
  constraint event_series_ends_after_start check (
    ends_on is null or ends_on >= starts_on
  )
);

create table public.events (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null references public.clubs(id) on delete cascade,
  -- A tidied-up rule must not cancel a club's games, so occurrences survive
  -- their series as ordinary one-off events.
  series_id       uuid references public.event_series(id) on delete set null,
  title           text not null check (length(trim(title)) > 0),
  venue_id        uuid not null references public.venues(id),
  notes           text not null default '',
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  status          public.event_status not null default 'published',
  -- The club-local date this row was generated for. Paired with series_id it
  -- is the idempotency key for materialization.
  occurrence_date date,
  -- Which fields a host has changed on this occurrence specifically. The
  -- `starts_at` key means "this occurrence's time was set by hand" and guards
  -- both instants, so a series edit to duration skips it too — otherwise a
  -- hand-set 6:30-9:30 week would keep its start and silently take the
  -- series' new length.
  overrides       text[] not null default '{}',
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),

  constraint events_ends_after_start check (ends_at > starts_at),
  constraint events_occurrence_requires_series check (
    (series_id is null) = (occurrence_date is null)
  ),
  constraint events_overrides_known_keys check (
    overrides <@ array['title', 'venue_id', 'notes', 'starts_at']
  ),
  -- Not decorative: the target of event_tables' composite foreign key.
  constraint events_id_club_unique unique (id, club_id)
);

/*
 * What makes materialization idempotent. Running the job twice inserts
 * nothing the second time, and a cancelled week is never resurrected because
 * its row still occupies the slot.
 */
create unique index events_series_occurrence_idx
  on public.events (series_id, occurrence_date)
  where series_id is not null;

create index events_club_starts_idx on public.events (club_id, starts_at);
create index events_series_idx on public.events (series_id);

create table public.event_tables (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null,
  club_id     uuid not null,
  label       text not null check (length(trim(label)) > 0),
  skill_tier  public.skill_tier not null default 'mixed',
  capacity    int not null default 4 check (capacity between 1 and 8),
  position    int not null check (position > 0),

  -- Composite, so a table row whose club_id disagrees with its event's is
  -- unrepresentable rather than merely unlikely. The parent spec requires
  -- every club-scoped table to carry club_id; this keeps that honest without
  -- a trigger to maintain and to get wrong.
  foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade,
  unique (event_id, position)
);

create index event_tables_event_idx on public.event_tables (event_id);

alter table public.event_series enable row level security;
alter table public.events enable row level security;
alter table public.event_tables enable row level security;

create policy event_series_select_member on public.event_series
  for select using (public.is_club_member(club_id));

-- Members see published and cancelled events; drafts are organizer business.
-- No screen creates a draft in this plan — the enum value and this clause
-- exist because the policy is easier to write once than to retrofit.
create policy events_select_member on public.events
  for select using (
    public.is_club_member(club_id)
    and (status <> 'draft' or public.is_club_organizer(club_id))
  );

create policy event_tables_select_member on public.event_tables
  for select using (public.is_club_member(club_id));

/*
 * No insert, update or delete policy on any of the three, and no DML grant.
 * Every mutation goes through a `security definer` function whose first
 * statement checks is_club_organizer against the row's OWN club.
 *
 * `alter default privileges` in 20260822041836 means these tables start with
 * nothing for authenticated; 20260822180200 means service_role already has
 * DML. Neither is inherited by accident — both were deliberate corrections
 * after `ALL` (which includes TRUNCATE, which RLS does not filter) turned out
 * to be the bootstrap default.
 */
grant select on public.event_series to authenticated;
grant select on public.events       to authenticated;
grant select on public.event_tables to authenticated;
