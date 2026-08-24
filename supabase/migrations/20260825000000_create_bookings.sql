/*
 * Booking: the four tables a seat needs.
 *
 * Clients hold `select` on three of them, nothing at all on the fourth,
 * and no DML anywhere. Every write goes through a `security definer`
 * function in a later migration. Three shapes here carry the design and are
 * worth reading before changing anything:
 *
 *   1. bookings.event_table_id is NULLABLE, and null means "any table" —
 *      confirmed for the game, not yet placed. It is not a pending state.
 *
 *   2. There is no waitlist_position integer. `waitlisted_at` orders the
 *      queue and position is computed on read. A stored position has to be
 *      renumbered on every departure, and "a group skipped for not fitting
 *      keeps its place" is free under time ordering.
 *
 *   3. There is no group `size` column. It is count(*) over the group's
 *      live bookings; a stored copy disagrees the first time one member of
 *      three declines.
 */

create type public.booking_status as enum
  ('confirmed', 'waitlisted', 'cancelled', 'declined');

/*
 * `declined` is not a flavour of `cancelled`. The booker's outbox row has
 * to say which happened: "Jane declined the seat you booked for her" and
 * "Jane cancelled" are different things to receive.
 */
create type public.booking_group_status as enum
  ('confirmed', 'waitlisted', 'cancelled');

create type public.promotion_outcome as enum
  ('accepted', 'declined', 'expired');

create type public.outbox_kind as enum (
  'booked_by_friend',
  'booking_declined',
  'booking_cancelled_by_host',
  'waitlist_promoted',
  'promotion_offer',
  'promotion_offer_expired',
  'unseated',
  'event_cancelled',
  'need_a_fourth'
);

/*
 * The composite foreign key target the booking tables need. Plan 3 gave
 * `events` its (id, club_id) unique for exactly this reason; event_tables
 * never needed one until now.
 */
alter table public.event_tables
  add constraint event_tables_id_event_unique unique (id, event_id);

create table public.booking_groups (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null,
  club_id            uuid not null,
  created_by         uuid not null references public.profiles(id),
  -- Null means "any table": nobody in this group is ever auto-placed, on
  -- commit or on promotion, and allow_split does not apply to them.
  preferred_table_id uuid,
  allow_split        boolean not null default true,
  status             public.booking_group_status not null default 'confirmed',
  waitlisted_at      timestamptz,
  created_at         timestamptz not null default now(),

  foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade,
  foreign key (preferred_table_id, event_id)
    references public.event_tables (id, event_id) on delete set null,

  constraint booking_groups_waitlisted_at_matches_status check (
    (status = 'waitlisted') = (waitlisted_at is not null)
  )
);

create table public.bookings (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.booking_groups(id)
                   on delete cascade,
  event_id       uuid not null,
  club_id        uuid not null,
  -- Null is "any table". See the note at the top of this file.
  event_table_id uuid,
  profile_id     uuid not null references public.profiles(id),
  -- Equal to profile_id for a self-booking. Different when a friend booked
  -- this seat, which is what gives the decline affordance somebody to tell.
  booked_by      uuid not null references public.profiles(id),
  status         public.booking_status not null default 'confirmed',
  cancelled_by   uuid references public.profiles(id),
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now(),

  foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade,
  -- Composite, so a booking cannot point at a table belonging to a
  -- different event. Plan 3's tenancy bugs were all of this shape.
  foreign key (event_table_id, event_id)
    references public.event_tables (id, event_id) on delete no action,

  constraint bookings_waitlisted_has_no_table check (
    status <> 'waitlisted' or event_table_id is null
  ),
  constraint bookings_closed_records_when check (
    (status in ('cancelled', 'declined')) = (cancelled_at is not null)
  )
);

/*
 * One active booking per person per event. This is what stops two friends
 * booking the same person into the same game, and what makes "already has
 * a seat" a constraint rather than a race.
 */
create unique index bookings_one_active_per_person_idx
  on public.bookings (event_id, profile_id)
  where status in ('confirmed', 'waitlisted');

create index bookings_event_status_idx
  on public.bookings (event_id, status);
create index bookings_table_idx
  on public.bookings (event_table_id) where event_table_id is not null;
create index bookings_profile_idx
  on public.bookings (profile_id, status);
create index booking_groups_queue_idx
  on public.booking_groups (event_id, waitlisted_at)
  where status = 'waitlisted';

create table public.promotion_offers (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null references public.booking_groups(id)
                       on delete cascade,
  event_id           uuid not null references public.events(id)
                       on delete cascade,
  offered_seat_count int not null check (offered_seat_count > 0),
  expires_at         timestamptz not null,
  responded_at       timestamptz,
  outcome            public.promotion_outcome,
  created_at         timestamptz not null default now(),

  constraint promotion_offers_outcome_matches_response check (
    (responded_at is null) = (outcome is null)
  )
);

/*
 * One outstanding offer per group. Two would each hold seats and the group
 * could only ever take one of them.
 */
create unique index promotion_offers_one_outstanding_idx
  on public.promotion_offers (group_id) where responded_at is null;

create index promotion_offers_sweep_idx
  on public.promotion_offers (expires_at) where responded_at is null;

/*
 * Plan 6's queue, written now.
 *
 * Nobody reads this table: no RLS policy, no grant to authenticated. Every
 * fact a member needs is surfaced from live state instead — promotion_offers
 * for a held offer, bookings.booked_by for a friend-booked seat, occupancy
 * and time for a table needing a fourth. This exists so that plan 6 adds
 * delivery and nothing else, and so a moment that has already passed (an
 * offer that expired unseen) leaves a trace.
 */
create table public.notification_outbox (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  club_id      uuid not null references public.clubs(id) on delete cascade,
  event_id     uuid references public.events(id) on delete cascade,
  kind         public.outbox_kind not null,
  payload      jsonb not null default '{}'::jsonb,
  -- The idempotency guard for both cron jobs. A 15-minute job that runs
  -- twice before anybody acts must not announce the same table twice.
  dedupe_key   text not null unique,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);

create index notification_outbox_unsent_idx
  on public.notification_outbox (created_at) where sent_at is null;

-- ---------------------------------------------------------------------
-- Capacity. The arithmetic every other migration in this plan relies on.
-- ---------------------------------------------------------------------

/*
 * These five are `security invoker` and granted to NOBODY. They run inside
 * `security definer` functions and inside the cron jobs, both of which
 * already carry the privileges to see the rows. Granting them to
 * authenticated would hand any signed-in user an occupancy oracle for an
 * event id belonging to a club they are not in.
 */
create function public.event_capacity(target_event uuid)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce(sum(capacity), 0)::int
  from public.event_tables where event_id = target_event;
$$;

create function public.event_confirmed_seats(target_event uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(*)::int from public.bookings
  where event_id = target_event and status = 'confirmed';
$$;

create function public.event_held_seats(target_event uuid)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce(sum(offered_seat_count), 0)::int
  from public.promotion_offers
  where event_id = target_event and responded_at is null;
$$;

/*
 * Floors at zero on purpose. Removing a table lowers capacity without
 * ejecting anybody, so an event can legitimately hold more confirmed
 * bookings than seats until the host sorts it out. That state admits
 * nobody new; it must not read as negative free seats.
 */
create function public.event_free_seats(target_event uuid)
returns int
language sql
stable
set search_path = public
as $$
  select greatest(0,
    public.event_capacity(target_event)
    - public.event_confirmed_seats(target_event)
    - public.event_held_seats(target_event));
$$;

create function public.table_free_seats(target_table uuid)
returns int
language sql
stable
set search_path = public
as $$
  select greatest(0, t.capacity - (
    select count(*)::int from public.bookings b
    where b.event_table_id = t.id and b.status = 'confirmed'
  ))
  from public.event_tables t where t.id = target_table;
$$;

/*
 * Mirrors is_club_member, and exists for the same reason: a promotion_offers
 * policy that asked this question inline through `bookings` would recurse
 * through bookings' own policy.
 */
create function public.is_booking_group_member(target_group uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.bookings
    where group_id = target_group and profile_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- RLS and grants.
-- ---------------------------------------------------------------------
alter table public.booking_groups      enable row level security;
alter table public.bookings            enable row level security;
alter table public.promotion_offers    enable row level security;
alter table public.notification_outbox enable row level security;

-- Who is coming is the club's business. That is the product.
create policy booking_groups_select_member on public.booking_groups
  for select using (public.is_club_member(club_id));

create policy bookings_select_member on public.bookings
  for select using (public.is_club_member(club_id));

-- An offer is the group's own business, not the whole club's.
create policy promotion_offers_select_group on public.promotion_offers
  for select using (public.is_booking_group_member(group_id));

-- notification_outbox deliberately has NO policy. RLS is on and nothing
-- passes it, so authenticated sees nothing even if a grant is added by
-- mistake later.

grant select on public.booking_groups   to authenticated;
grant select on public.bookings         to authenticated;
grant select on public.promotion_offers to authenticated;
-- No grant on notification_outbox to anyone but service_role, which holds
-- DML by default privilege (20260822180200).

revoke execute on function public.event_capacity(uuid)         from public, anon;
revoke execute on function public.event_confirmed_seats(uuid)  from public, anon;
revoke execute on function public.event_held_seats(uuid)       from public, anon;
revoke execute on function public.event_free_seats(uuid)       from public, anon;
revoke execute on function public.table_free_seats(uuid)       from public, anon;
revoke execute on function public.is_booking_group_member(uuid) from public, anon;
grant  execute on function public.is_booking_group_member(uuid) to authenticated;
