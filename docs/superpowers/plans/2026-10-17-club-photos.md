# Photos & Files (Club-Hub Phase 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hub's "coming soon" Photos section with a club photo album and shared file list per Design V3 frame 1d.

**Architecture:** One migration adds `club_media`, a private `club-media` bucket with policies, and `add_club_media` / `remove_club_media` RPCs. `lib/club-media.ts` wraps listing, uploading (photos via the existing compress/upload helpers, files via `expo-document-picker`), signed URLs and removal. `components/media/*` render the grid, viewer and file rows; `app/clubs/[id]/(hub)/photos.tsx` composes them.

**Tech Stack:** Expo Router 57 / React Native / react-native-web, Supabase (Postgres, Storage, pgTAP), `expo-document-picker` (new), vitest + @testing-library/react, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-club-photos-design.md`

## Global Constraints

- Text/TextInput from `components/Text`; colours from `lib/theme.ts` (`'#fff'` allowed); 44pt targets; new icons Lucide-style, stroke 2.75 (`FileIcon`, `DownloadIcon`, `MoreHorizontalIcon`, `ChevronLeftIcon`/`ChevronRightIcon` exist).
- Copy (exact): "Photos", "Files", "Add photos", "Add a file", "No photos yet. Tap + to add the first one.", "No files yet. Tap + to add one.", "Uploading {i} of {n}…", "That file type isn't supported.", "Files can be up to 10 MB.", "Show more", "Added by {name} · {Wkd D Mon}", "Remove", "Remove this photo?", "Remove this file?", "Cancel".
- Allowed file types (by extension and mime): pdf, doc, docx, xls, xlsx, csv, ppt, pptx, txt; max 10 MB (10 * 1024 * 1024 bytes). Photos: ≤10 per batch, compressed to 1600px JPEG.
- Paths: `{club_id}/photos/{uuid}.jpg`, `{club_id}/files/{uuid}/{sanitised name}` (sanitise: keep letters, digits, `.`, `-`, `_`; others → `_`; max 100 chars).
- Who: any active member uploads; uploader or host/co_organizer removes.
- Migrations forward-only; security definer + `search_path = public` + `auth.uid()` guard; revoke `public, anon`; client RPCs in both `grants.test.sql` allowlists; new raise messages in `lib/bookings.test.ts` exemptions.
- Local Supabase only in tasks; dev/prod pushes by the controller. Never `config push`.
- Git: explicit paths; never `CLAUDE.md`, `docs/product-brief.md`, `social media assets/`, `.claude/launch.json`. Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A member of another club, or a removed member, tries to read or write another club's media** (via table select, storage read, storage insert, or RPC) → refused. Tests in Task 1.
2. **Uploading a disallowed or oversized file, or a path outside the club's folder** → refused client-side with the exact copy and server-side by the RPC. Tests in Tasks 1 and 2.
3. **One photo in a batch fails to upload** → the others still finish; the failure is reported; no orphaned `club_media` row without an object (insert row only after upload succeeds; delete the object if the RPC fails). Tests in Task 2.
4. **Removing media** → row and storage object both gone; non-uploader members can't see a Remove control and the RPC refuses them. Tests in Tasks 1 and 4.
5. **File names with spaces, accents, emoji or slashes** → stored under a sanitised path, displayed with the original name. Test in Task 2.

---

### Task 1: Media table, bucket and RPCs

**Files:** Create `supabase/migrations/20261017110000_club_media.sql`, `supabase/tests/database/fixtures/club_media.test.sql`; modify `grants.test.sql`, `lib/bookings.test.ts` (new raise messages).

**Produces:** table `club_media` (per spec), RLS select for `is_club_member(club_id)`; bucket `club-media` (private); storage policies: select for members of the folder's club, insert for members of the folder's club, delete when the caller is an organizer of the folder's club **or** is the `uploaded_by` of a `club_media` row with that `storage_path`; `add_club_media(target_club uuid, p_kind text, p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes int, p_width int default null, p_height int default null) returns uuid` — member check (42501), path must start with `target_club::text || '/photos/'` for photos or `'/files/'` for files (`invalid_path` 22023), kind in photo/file (`invalid_kind`), files: allowed mime list and size ≤ 10485760 (`file_not_allowed`, `file_too_large`); `remove_club_media(media_id uuid) returns text` — uploader or `is_club_organizer` else 42501; deletes the row and returns its storage_path.

- [ ] **Step 1: Failing pgTAP** covering: member adds a photo and a file; non-member add → 42501; wrong path prefix → invalid_path; file too large → file_too_large; disallowed mime → file_not_allowed; member of another club can't select rows; removed member can't select; uploader removes own row (returns path); other plain member remove → 42501; organizer removes anyone's; storage select/insert as member under own club vs another club; anon can't execute.
- [ ] **Step 2:** `npx supabase db reset --local && npm run test:db` → FAIL. **Step 3:** migration. **Step 4:** allowlists + exemptions; full `npm run test:db` + `npm test -- lib/bookings.test.ts` pass. **Step 5: Commit** `feat(db): club media table, bucket and RPCs`.

---

### Task 2: Media client library

**Files:** `npx expo install expo-document-picker` (package.json/lock); create `lib/club-media.ts`, `lib/club-media.test.ts`.

**Produces:**
- `type ClubMedia = { id; clubId; kind: 'photo' | 'file'; storagePath; fileName; mimeType; sizeBytes; width: number | null; height: number | null; uploadedBy: string; uploaderName: string; createdAt: string }`
- `fetchClubMedia(clubId: string, kind: 'photo'|'file', before?: string /* createdAt */, limit = 60): Promise<ClubMedia[] | null>` (calls the `fetch_club_media` RPC — security definer, returns `uploader_name` — rather than a select joined with `profiles(display_name)`, which RLS on profiles would blank for other uploaders; order `created_at desc`).
- `uploadClubPhotos(clubId: string, images: PickedImage[], onProgress?: (done: number, total: number) => void): Promise<{ added: number; errors: string[] }>` — per image: compress → upload to `{club}/photos/{uuid}.jpg` (no upsert) → `add_club_media`; if the RPC fails, delete the uploaded object.
- `pickClubFile(): Promise<PickedFile | null>` and `uploadClubFile(clubId: string, file: PickedFile): Promise<{ error: string | null }>` with client validation (`fileTypeAllowed(name, mime)`, size) using the exact copy.
- `removeClubMedia(media: ClubMedia): Promise<{ error: string | null }>` — RPC then storage remove of the returned path (ignore remove error).
- `getMediaUrls(paths: string[]): Promise<Record<string, string>>` (batched signed URLs with a cache that expires a few minutes before the TTL).
- Pure: `sanitiseFileName(name)`, `fileTypeLabel(name)` (PDF/DOC/XLS/PPT/CSV/TXT/FILE), `formatBytes(n)` ("120 KB", "1.4 MB"), `fileTypeAllowed(name, mime)`.

- [ ] **Step 1: Failing tests** for each (mock `./supabase` and the picker modules): select shape and mapping; batch upload with one failure → others added, failure reported, orphan object removed (Review Focus 3); oversized and disallowed files refused with exact copy without network calls (Review Focus 2); `sanitiseFileName('Ré sumé/✓ v2.pdf')` → `R_sum__v2.pdf`-style (assert exact output you choose and document), display name unchanged (Review Focus 5); remove calls RPC then storage remove; `formatBytes` cases; URL cache expiry.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** pass + tsc. **Step 5: Commit** `feat(lib): club media client and expo-document-picker`.

---

### Task 3: Media components

**Files:** create `components/media/PhotoGrid.tsx`, `components/media/MediaViewer.tsx`, `components/media/FileRow.tsx`, `components/__tests__/media-parts.test.tsx`; icons in `components/icons.tsx`. Optionally extract the viewer from `components/messages/AttachmentGrid.tsx` into `MediaViewer` and reuse it there (keep its tests green).

**Produces:** `PhotoGrid({ photos: ClubMedia[], urls, onOpen(index) })` (3 columns, square cells, 3px gaps, outer top corners radius 14, placeholder while a URL is missing); `MediaViewer({ items: { url, caption }[], startIndex, onClose, canRemove(index) => boolean, onRemove(index) })` (dark modal, close, prev/next, caption, Remove with confirm); `FileRow({ file: ClubMedia, onOpen, canRemove, onRemove })` (icon tile with type label, name ellipsis, meta "{TYPE} · {size} · {uploader}", download button, "…" menu with Remove + confirm).

- [ ] **Step 1: Failing tests:** grid renders N cells and calls onOpen(i); viewer caption "Added by Priya Shah · Tue 29 Sept", next/prev bounds, Remove hidden when `canRemove` false, confirm then onRemove; FileRow meta line, download press, Remove hidden for non-owners.
- [ ] **Step 2–4:** FAIL → implement → pass + tsc. **Step 5: Commit** `feat(media): photo grid, viewer and file rows`.

---

### Task 4: Photos section

**Files:** rewrite `app/clubs/[id]/(hub)/photos.tsx`; tests `app/__tests__/club-photos-section.test.tsx` (replace the placeholder test).

- [ ] **Step 1: Failing tests:** segmented control Photos (default) / Files; upload button labelled "Add photos" / "Add a file" per tab; photo upload shows "Uploading 2 of 3…" and reloads; a refused file shows the exact error; empty states; "Show more" pages; Remove visible to uploader and organizers only and removes the item after confirm (Review Focus 4); pull-to-refresh and focus reload.
- [ ] **Step 2–4:** FAIL → implement (HubSection with onRefresh; role from `useClubHub`; `canInvite(role)` for organizer) → pass; full `npm test` + tsc.
- [ ] **Step 5: QA Pass:** read live; add Photos/Files steps (new data-ids) with exact copy; update totals; republish in place.
- [ ] **Step 6: Commit** `feat(hub): Photos and Files section`.

---

### Task 5: Baselines, dev push, browser check, PR (controller)

- [ ] Playwright: replace the `club photos` placeholder baseline with Photos (seeded photos), Files (seeded files) and empty states; eye-check; reset DB; `npm run test:db`.
- [ ] Push the migration to hosted dev (dry-run first).
- [ ] Browser check on a local build at 375×812: add photos, view, remove; add a PDF, open it, remove; refused type/size.
- [ ] Push branch, open PR (prod push before merge; native rebuild needed for Files on phones).
