/**
 * The shapes this function passes around, and nothing else.
 *
 * `RenderRow` mirrors `claim_notification_batch`'s return columns one for
 * one. If a column is added there, it is added here, in the same order —
 * the RPC is the contract and this is the copy of it.
 */

export type OutboxKind =
  | 'booked_by_friend'
  | 'booking_declined'
  | 'booking_cancelled_by_host'
  | 'waitlist_promoted'
  | 'promotion_offer'
  | 'promotion_offer_expired'
  | 'unseated'
  | 'event_cancelled'
  | 'need_a_fourth'
  | 'event_reminder'
  | 'broadcast';

export type RenderRow = {
  id: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  recipient_id: string;
  recipient_name: string;
  recipient_email: string;
  channel: string;
  club_id: string;
  club_name: string;
  // Null for a club-wide broadcast, which has no event by nature, and also
  // for an `event_cancelled` row once the occurrence it pointed at is
  // gone: 20260825042000_series_shortening_tells_the_booked.sql writes
  // those rows with event_id already null so the notification survives
  // the cascade-delete of the dropped occurrence.
  event_id: string | null;
  event_title: string | null;
  event_starts_at: string | null;
  club_timezone: string;
  table_label: string | null;
  actor_name: string | null;
  broadcast_subject: string | null;
  broadcast_body: string | null;
  created_at: string;
};

/** One call to action. At most one per message, deliberately. */
export type Cta = { label: string; url: string };

/**
 * What a message says, before it is any particular format. Both the HTML
 * and the plain-text parts are built from this — the text is never scraped
 * out of the HTML, which is how text parts end up full of stray markup.
 */
export type Body = {
  subject: string;
  headline: string;
  paragraphs: string[];
  cta: Cta | null;
  footerNote: string;
};

export type Message = {
  to: string;
  subject: string;
  html: string;
  text: string;
};
