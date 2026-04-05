# Changelog

All notable changes to this project are documented here.

---

## [Unreleased] — 2026-04-05

### Added

#### Exercise dialogs — muscle group & category filters
- Add Exercise and Replace Exercise bottom sheets now include **Muscle Group** and **Category** dropdown filters (Select components), making it easy to narrow a large exercise list on mobile
- Filters are independent per dialog; resetting one dialog does not affect the other

#### Mobile-first exercise dialogs — BottomSheet
- Both Add Exercise and Replace Exercise dialogs redesigned as `BottomSheet` components: slide up from the bottom of the screen, drag handle, title bar with close button, `max-h-[88dvh]` constraint
- New shared component `frontend/src/components/ui/bottom-sheet.tsx` built on the `@base-ui/react` Dialog primitive with `slide-in-from-bottom` / `slide-out-to-bottom` animations

#### Per-user exercise isolation
- Exercises are now scoped to individual users via a `user_id` FK on the `Exercise` model
- All exercise API endpoints require authentication and return only the requesting user's exercises
- `program_seed.py` creates exercises with the user's `user_id` so seeded exercises are immediately per-user
- Backend migration (`migrate_exercise_ownership`) runs as a background task on startup: copies existing global exercises to each user and re-keys all foreign references (`session_exercises`, `plan_exercises`, `suggestion_logs`, `volume_history`), then removes the now-orphaned global rows

### Changed

#### Date formatting
- Exercise history entries now show the year: `MMM d` → `MMM d, yyyy` (e.g. "Apr 4, 2024")
- Session scheduled date now shows the full weekday and year: `EEEE, MMMM d, yyyy` (e.g. "Saturday, April 4, 2026")

#### Code cleanup
- Unified duplicate `muscleGroups` / `categories` useMemos (previously one copy each for Add and Replace dialogs) into single shared memos
- Extracted `filterExercises(excludeId, search, muscle, category)` helper used by both dialog lists
- Removed unused `@utility no-scrollbar` block from `globals.css` (replaced by Select dropdowns)
- Moved `import uuid` / `import logging` and module-level `log` to the top of `database.py`

### Fixed

#### Login hanging after exercise isolation changes
- The exercise ownership migration was running synchronously inside `init_db()`, which blocked the FastAPI lifespan from yielding — no requests (including login) were served until the migration completed
- Fixed by moving the migration to `asyncio.create_task()` so startup completes immediately and the migration runs in the background

#### React hydration mismatch on login page
- LastPass browser extension injects a `<div data-lastpass-icon-root="">` node into the form before React hydrates, causing a mismatch error in the console
- Fixed with `suppressHydrationWarning` on the `<form>` element

#### Cancelled session shows no Edit button
- The Edit button was incorrectly shown for cancelled sessions because `isCompleted` was `true` for both `completed` and `cancelled` status
- Fixed: Edit button is now only rendered when `session.status === 'completed'`

### Tests

#### Frontend — session detail page (all 107 passing)
- Extracted `SessionDetailInner({ id: string })` as a named export from `page.tsx`; the default export is now a thin wrapper that calls `use(params)` and renders `<SessionDetailInner>`
- Tests import and render `SessionDetailInner` directly, bypassing the `use(params)` Suspense suspension that caused all tests to render only the fallback under Jest fake timers
- Updated selectors: `0/2` (no spaces), `Add Set` (Plus is an SVG icon, not a `+` character), `getAllByText` for volume (both session header and exercise card show the same value), `aria-label="Back"` on the back button, `title="Remove exercise"` on the exercise X button
- Added `aria-label="Back"` and `title="Remove exercise"` to the respective elements in `page.tsx`

#### Backend — exercises (all 112 passing)
- `test_list_exercises_empty` → renamed `test_list_exercises_requires_auth`; exercises now require auth so the unauthenticated request returns 401
- `test_list_exercises_returns_all` → uses delta-based assertion (`before + 3`) to account for exercises seeded on registration
- `test_list_exercises_filter_by_muscle_group` → same delta approach; verifies all returned exercises match the filtered muscle group
- `test_get_exercise_not_found` → switched from `client` to `auth_client` since the endpoint now requires auth

---

## [Unreleased] — 2026-04-04

### Fixed

#### Session page — "Prev" rendering bug
- **Bug**: the "Prev" column (showing previous session performance) often rendered as `—` even when history existed
- **Root cause**: history API returned the current (incomplete) session as the first entry; frontend took `entries[0]` which had no sets yet
- **Fix**: frontend now filters out the current session ID when computing `prevSetsMap`, correctly identifying the most recent *past* performance
- **Backend update**: added `session_id` to the `GET /api/exercises/{id}/history` response to enable this filtering

#### Session page — ghost placeholder regression
- **Bug**: completing a set caused ghost placeholder values to disappear from all remaining pending sets
- **Root cause**: ghost seed was derived from the first pending set's template value; after a set was completed its edit entry was deleted, making the next pending set appear to have no template, so `lastGhostWeight / lastGhostReps` became empty
- **Fix**: ghost seed now walks completed non-warmup sets first; only falls back to the first pending set's template when no completed sets exist yet
- Extracted `computeGhostMap` into `frontend/src/lib/ghost-map.ts` as a pure utility function so the logic is unit-testable independent of React

### Added

#### Tests — ghost map unit tests (`frontend/src/__tests__/ghost-map.test.ts`)
- 10 unit tests for `computeGhostMap` covering:
  - No history: empty map when all template values are zero
  - Template propagation: first pending set's template seeds ghost for all pending sets
  - **Regression case**: completing set 1 → ghost propagates from completed weight/reps to sets 2, 3, etc.
  - Multiple completed sets: uses the last completed set, not the first
  - Warmup sets excluded as ghost seed source
  - User-typed values update the running ghost for downstream sets
  - Zero-weight (bodyweight) completed sets do not contribute to weight ghost

### Changed

#### Session page — "Prev" column visibility & layout
- Increased "Prev" column width from `w-10` to `w-12` (48px) to prevent truncation of values like `225×10`
- Darkened "Prev" text color (from 40/50% opacity to 60%) for better readability
- Removed `truncate` class from "Prev" label to ensure values are never hidden
- Updated RPE column in completed rows to `w-11` to match the header and editable rows

#### Session page — SetRow mobile tap targets
- Input height increased from `h-9` (36 px) to `h-11` (44 px) — meets Apple's minimum recommended touch target
- Input font size increased from `text-sm` to `text-base` for easier reading on mobile
- Set number and previous-set reference merged into a single stacked `w-12` column, freeing a full flex column for weight and reps inputs
- Complete button increased from `size-9` to `size-11` with `rounded-xl`
- Column headers aligned to the new layout widths

#### Sessions list — history filter row mobile layout
- Replaced single `flex-wrap` row (wraps unpredictably on small screens) with an explicit two-row layout on mobile: heading + month navigator on row 1, status filter + sort button on row 2
- Collapses back to a single row at the `sm:` breakpoint

---

## [Unreleased] — 2026-04-02

### Added

#### Mobile navigation — bottom bar
- Fixed bottom nav bar replaces the hamburger/top menu on mobile
- Layout: **Dashboard | Sessions | [+] | Exercises | More** — `+` centered
- `+` button creates a new session immediately and navigates to it
- **More drawer** slides up above the nav bar with: Suggestions, Plans, Cycles, Settings, theme toggle, sign out
- Top nav hidden on mobile (`md:block` only)
- Bottom nav slides away (`translateY(100%)`) when entering a session detail page — full-screen workout experience
- Safe-area inset applied (`env(safe-area-inset-bottom)`) so the bar fills to the screen edge on iPhone

#### Session page — redesigned mobile UX
- **Page transition**: session detail slides up from below on open (`slideUpPage` animation)
- **Header**: single-row 3-column grid — `[←]` left · `[timer]` center · `[Finish/Start/Edit]` right
- **Session title + date** moved out of the header into the page body above exercises — large, readable, no card wrapper
- **Scroll-driven title fade**: title drifts up and fades to transparent as the user scrolls down; gracefully returns on scroll up
- **Live workout timer** shown in header center when session is `in_progress`; timer does not start until the first exercise or template is added; resets reference time on first add
- **Finish button** is green with a checkmark icon for clear affordance

#### Session page — AI weight suggestions
- Suggestion strip lives inside the exercise header, below the exercise name — no extra row
- **Amber colour** for unnapplied suggestions; **green + checkmark** when applied
- One tap applies the suggested weight to all uncompleted sets; tap again to undo (sets cleared, strip returns to amber)
- `tap to undo` hint shown when applied
- Strip hidden entirely when `suggested_weight === 0` (no history for the exercise)
- `suggestion-apply-pop` bounce animation on apply; `suggestion-undo-shake` wiggle on undo

#### Session page — set interactions
- **Swipe left on set row** reveals a red trash icon and deletes the set; `set-delete-slide` animation collapses the row before removal
- Swipe left removed from exercise card — only swipe right (replace exercise) remains on the card
- Set completion `set-completed-pop` bounce retained

#### Session page — exercise search dialogs
- Add Exercise and Replace Exercise dialogs use `max-h-[80dvh]` (dynamic viewport height) so they resize when the keyboard opens
- `autoFocus` removed from search inputs — keyboard no longer blasts open immediately on mobile
- List area uses `flex-1 overflow-y-auto` so the search bar stays pinned while results scroll

#### Plans page — unsaved changes bar
- Bar now positions at `bottom-16` on mobile (above the bottom nav) and `bottom-0` on desktop

#### Apply Plan Template
- Template dialog no longer requires the session to be in Edit mode to open
- Dialog is no longer conditionally rendered based on `isEditing` — stays mounted independently
- Error feedback shown inline when the apply API call fails
- Fixed: session rename after apply used `PATCH` which returned 405 — changed to `PUT`

### Changed

- All scrollbars hidden on mobile via global `@media (max-width: 768px)` rule covering `-webkit-scrollbar`, `scrollbar-width`, and `-ms-overflow-style`
- `.scrollbar-none` utility class now has explicit cross-browser CSS (was relying on a missing Tailwind plugin)

---

## [Unreleased] — 2026-03-30

### Added

#### Plans — Draft-based editing
- All plan edits (name, description, sessions, exercises, targets) are held in local draft state and only committed to the database when the user explicitly hits **Save Changes**
- **Discard** button reverts the draft to the last saved server state
- Sticky "Unsaved changes" bottom bar appears whenever the draft differs from the server
- Plan title and description now have a pencil-toggle edit mode (read-only by default, click pencil to edit)
- Exercise target rows (sets / reps / weight / rest) use pencil-toggle edit mode — inputs update the draft directly without a per-row Save/Cancel

#### Plans — Week structure
- Plan sessions are now grouped into **Week 1, Week 2, ...** sections (new `week_number` column on `plan_sessions`)
- "Add Day to Week N" and "Add Week N" buttons let you build multi-week programs
- `week_number` is preserved through save/discard cycles and sent to the backend on save

#### Plans — Create exercise inline
- Searching for an exercise in the "Add Exercise" dialog shows a **Create "..."** option at the bottom of the list (and as the only option when no results match), so you can create and add a new exercise without leaving the plan

#### Exercises — Edit dialog
- Pencil icon on each exercise card opens an edit dialog pre-filled with name, muscle group, category, and description
- Calls `PUT /api/exercises/:id`

#### Bodyweight category
- New `category` field on exercises: `weighted` (default) or `bodyweight`
- Bodyweight exercises hide weight inputs and weight columns throughout: plan editing, session logging, set rows, exercise history panel, and the apply-plan dialog
- Category selector added to both the global exercises page and the inline "Create exercise" dialog in plans

#### Weight suggestions — RP-style algorithm
- **Reference point** changed from 50-set average to the **top set** (max weight) of the most recent completed session, preventing drop sets from dragging down the suggestion
- **RPE thresholds** recalibrated for hypertrophy:
  - `< 7` — too easy → +5 lbs
  - `7–8` — optimal → +2.5 lbs
  - `8–9` — solid late-meso effort → +2.5 lbs
  - `9–9.5` — hold weight, chase reps (+1 rep target in message)
  - `≥ 9.5` — back off ~5%
- **Meso-aware**: optional `?meso_cycle_id=` query param restricts history to the current program block
- **Rep-aware messaging**: when RPE is high and weight should hold, the reason string targets `last_reps + 1`
- Session-over-session progression detection when no RPE is logged
- Rounds suggestions to nearest 2.5 lbs for practical plate loading

#### Suggestion logs (`suggestion_logs` table)
- Every call to `GET /api/suggestions/weight` automatically writes a row to `suggestion_logs` (per user, per exercise, per meso cycle)
- Stores: `previous_weight`, `average_rpe`, `suggested_weight`, `adjustment_reason`, `created_at`
- Optional outcome columns: `actual_weight`, `actual_reps`, `actual_rpe` — filled in via `PATCH /api/suggestions/weight/history/{log_id}`
- New endpoints:
  - `GET /api/suggestions/weight/history` — filterable by `exercise_id`, `meso_cycle_id`, `limit`
  - `PATCH /api/suggestions/weight/history/{log_id}` — record what the user actually lifted

#### Rest timer redesign
- Full-width fixed bottom bar (`fixed bottom-0 inset-x-0`) replaces the old small inline timer
- Progress bar at the top of the bar, large `text-4xl` countdown, stretch adjustment buttons (−30s / −15s / +15s / +30s), and a Skip button

#### Plans — Cancel button on create dialog
- Create Plan dialog now has explicit **Cancel** and **Create** buttons

### Changed

- `PUT /api/plans/{plan_id}` endpoint added for updating plan name and description
- `plan_sessions` table: `week_number INTEGER DEFAULT 1` column added via migration
- `exercises` table: `category TEXT DEFAULT 'weighted'` column added via migration
- Each database migration now runs in its own `engine.begin()` block (PostgreSQL transaction isolation fix — previously a failed migration aborted all subsequent ones)
- `suggestion_logs` table: `actual_weight`, `actual_reps`, `actual_rpe` columns added via migration (safe no-ops on fresh installs)

---

## Earlier — see git log

For changes prior to 2026-03-30 (Fitbit caching, Fitbit 429 handling, session sticky header, UTC timezone fix) refer to `git log`.
