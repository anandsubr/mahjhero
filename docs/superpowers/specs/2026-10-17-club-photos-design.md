# Photos & Files (club-hub redesign, phase 5)

Date: 2026-10-17
Design source: `docs/design/club-hub-v3/` — README "Photos" and frame **1d** in `Club Hub.dc.html` /
`docs/superpowers/specs/assets/2026-09-29-club-hub-screens.png`.
The user opted out of questions ("go ahead"); every choice the design doesn't fix is marked
*(call)* and was made by Claude.

## Intent

Give each club a shared place for its photos (game nights, tournaments) and its documents (house
rules, scorecards, cheat sheets). Today the Photos section is a "coming soon" note.

## Goals

- Photos / Files segmented control and a 48pt `accent[700]` upload button, per frame 1d.
- **Photos:** 3-column square grid, 3px gaps, the grid's outer top corners radius 14; tap opens a
  full-screen viewer (swipe/arrow through photos) showing who added it and when.
- **Files:** `surface` card rows (min 62pt): file-type icon tile, file name, a meta line
  "PDF · 120 KB · Priya Shah", and a download button that opens the file.
- Any club member can add photos and files; the uploader or a host/co-organizer can remove one.

## Non-goals

- No albums, captions, comments, likes or tagging on photos.
- Board post photos do not appear in Photos *(call: Photos is the club's album; board photos stay
  with their posts)*.
- No file previews inside the app beyond photos; files open in the browser / OS viewer.
- No storage quotas or usage display.

## Behaviour

- **Segmented control:** "Photos" (default) / "Files" *(call: default Photos, as the frame)*; not
  remembered.
- **Upload button:** on Photos it opens the photo library (multi-select, up to 10 per batch
  *(call)*); each photo is compressed to 1600px JPEG like message attachments, then uploaded. On
  Files it opens the document picker (one file at a time *(call)*).
  - Allowed files *(call)*: PDF, Word (.doc/.docx), Excel (.xls/.xlsx), CSV, PowerPoint
    (.ppt/.pptx), plain text; max **10 MB**. Anything else → "That file type isn't supported." /
    too big → "Files can be up to 10 MB."
  - While uploading, a small progress row shows "Uploading 2 of 5…"; failures show an inline error
    and the rest continue.
- **Ordering:** newest first in both tabs.
- **Photos grid:** loads 60 at a time with "Show more" *(call)*; empty state "No photos yet. Tap +
  to add the first one."
- **Viewer:** full-screen dark modal, close button, previous/next (and swipe on native), caption
  line "Added by Priya Shah · Tue 29 Sept". A **Remove** button for the uploader and organizers,
  with a confirm "Remove this photo?" → "Remove".
- **Files list:** each row shows the extension-based icon tile (PDF, DOC, XLS, PPT, CSV, TXT),
  name (one line, ellipsis), meta "{TYPE} · {size} · {uploader}". Tap the row or the download icon
  → opens a short-lived signed link (new tab on web, `Linking.openURL` on native). Long-press (native)
  or a "…" button (all platforms) offers **Remove** to the uploader and organizers, with a confirm.
  Empty state "No files yet. Tap + to add one."
- Pull to refresh; refetch on focus.

## Data

- Table `club_media(id uuid pk, club_id uuid → clubs on delete cascade, kind text check in
  ('photo','file'), storage_path text unique not null, file_name text not null, mime_type text not
  null, size_bytes int not null, width int, height int, uploaded_by uuid → profiles,
  created_at timestamptz default now())`; index `(club_id, kind, created_at desc)`.
- RLS: select for active club members; no direct insert/update/delete — writes go through RPCs.
- Private storage bucket `club-media`; object paths `{club_id}/photos/{uuid}.jpg` and
  `{club_id}/files/{uuid}/{sanitised file name}`. Storage policies: read for club members; insert
  for club members under their club's folder; delete for organizers *(the RPC deletes the object
  for uploader removals via the service path — builder's call how, e.g. client deletes the object
  after the RPC returns the path, with a storage delete policy allowing the uploader of a
  `club_media` row or an organizer)*.
- RPCs (security definer, member checks): `add_club_media(target_club, kind, storage_path,
  file_name, mime_type, size_bytes, width, height) returns uuid` (validates path prefix, kind/mime,
  size ≤ 10 MB for files) and `remove_club_media(media_id) returns text` (uploader or organizer;
  returns the storage path so the client can delete the object).
- Listing via PostgREST select on `club_media` with the uploader's display name (join `profiles`),
  ordered by `created_at desc`, paged.

## Constraints

- Same conventions as earlier phases: Text/TextInput from `components/Text`; colours from
  `lib/theme.ts`; 44pt targets; Lucide-style icons at stroke 2.75 (new: file, download, more).
- Reuse `lib/attachments.ts` (`pickImages`, `compressImage`, signed-URL caching approach) and the
  image viewer pattern in `components/messages/AttachmentGrid.tsx` (extract a shared viewer if it
  helps).
- New dependency: `expo-document-picker` (installed with `npx expo install`); native apps need a
  new build before Files can pick documents. Web works immediately.
- Grants/allowlist/self-audit conventions; migration pushed to hosted dev before the user tests,
  and to prod before merge.
- QA Pass checklist updated per `CLAUDE.md`.

## Left to the builder

- Shared viewer extraction; how removal deletes the storage object (RPC returns path + client
  delete, or a policy-based delete).
- Signed-URL caching for thumbnails (reuse the attachments approach).
- Test structure; Playwright baselines for Photos (with photos), Files (with files) and empty states.
