/*
 * RSVPs for a Mahj Night (pivot batch 2). No sign-in needed: a guest gives a
 * name, an email and an answer.
 *
 * An RSVP is not a seat or a membership. When the guest later signs in with
 * the email code (to message, pick a seat or join a group), claim_my_rsvps
 * links the row to their account by that verified email and adds them to the
 * event group (20261128130000).
 *
 * rsvp_secret is what proves "this browser made this RSVP": it is returned
 * once, to the browser that created the row, and sent in the guest's
 * confirmation email. With it the event page shows the yes-guest view and
 * lets the guest change their answer.
 *
 * RLS on, no policies, privileges revoked: every read and write goes through
 * the definer functions, which are callable only by the service-role edge
 * function (and, for claim_my_rsvps, by the signed-in guest themself).
 */

create type public.rsvp_status as enum ('going', 'maybe', 'no');

create table public.event_rsvps (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 80),
  email        text not null check (length(email) between 3 and 254 and position('@' in email) > 1),
  status       public.rsvp_status not null,
  is_beginner  boolean not null default false,
  profile_id   uuid references public.profiles(id) on delete set null,
  rsvp_secret  text not null unique
    default rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '='),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One RSVP per email per night; emails compare case-insensitively.
create unique index event_rsvps_event_email_key
  on public.event_rsvps (event_id, lower(email));
create index event_rsvps_profile_idx on public.event_rsvps (profile_id);
create index event_rsvps_email_idx on public.event_rsvps (lower(email));

alter table public.event_rsvps enable row level security;
revoke all on public.event_rsvps from public, anon, authenticated;

/*
 * Rate-limit logs. submit_rsvp counts attempts per link and per IP address;
 * claim_rsvp_email_slot counts emails per RSVP and per address, so the RSVP
 * form can't be used to send mail to someone over and over.
 */
create table public.rsvp_attempts (
  id           bigint generated always as identity primary key,
  club_id      uuid not null references public.clubs(id) on delete cascade,
  client_ip    text not null,
  attempted_at timestamptz not null default now()
);
create index rsvp_attempts_recent on public.rsvp_attempts (club_id, client_ip, attempted_at);
alter table public.rsvp_attempts enable row level security;
revoke all on public.rsvp_attempts from public, anon, authenticated;

create table public.rsvp_emails (
  id       bigint generated always as identity primary key,
  rsvp_id  uuid not null references public.event_rsvps(id) on delete cascade,
  email    text not null,
  sent_at  timestamptz not null default now()
);
create index rsvp_emails_recent on public.rsvp_emails (lower(email), sent_at);
alter table public.rsvp_emails enable row level security;
revoke all on public.rsvp_emails from public, anon, authenticated;
