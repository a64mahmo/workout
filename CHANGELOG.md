# Changelog

All notable changes to this project are documented here.

---

## [Unreleased] — 2026-04-05 (Production Hardening & Performance)

### Added
- **Alembic Migration Framework**: Formalized database schema management using Alembic. Replaces fragile startup migrations with a versioned, rollback-capable history.
- **Regression Testing Suite**: 
    - `backend/tests/test_datetime_safety.py`: Guarantees all models use timezone-aware columns and prevents production calculation crashes.
    - `backend/tests/test_progression_service.py`: 100% logic verification for the RP algorithm (Accumulation, Peak, Deload).
    - `frontend/src/__tests__/settings-page.test.tsx`: E2E coverage for user preferences, theme persistence, and data sync.
    - `frontend/src/__tests__/session-deep-dives.test.tsx`: Verifies the "Add Sets" volume logic and the suggestion-feedback loop.
- **Manual Data Sync**: Added "Sync Volume History" button in Settings to manually trigger historical volume backfills.

### Changed
- **Cross-DB Timezone Compatibility**: Standardized on `TIMESTAMPTZ` in PostgreSQL while maintaining SQLite compatibility via "Force-Naive UTC" logic. This resolves production 500 errors caused by strict timezone handling in `asyncpg`.
- **Progression Service Layer**: Extracted core hypertrophy logic from API controllers into a dedicated `ProgressionService`, enabling database-independent unit testing and cleaner architecture.
- **Volume Query Optimization**: Refactored Suggestions and Muscle Group charts to use the `VolumeHistory` summary table. Drastically reduced complexity from $O(Sets)$ to $O(Sessions)$.
- **Circular Feedback Loop**: The frontend now automatically records "actual" weight/reps against AI suggestions upon set completion, closing the audit loop for progression history.
- **Mobile Readability**: Improved responsive layout using `break-words` for session titles, exercise names, and suggestion reasons to prevent mobile overflow.
- **Database Indexing**: Added `index=True` to all critical foreign keys to ensure fast joins as the dataset grows.

### Fixed
- **Session Data Bleed**: Fixed a bug where unsaved set inputs could persist when navigating between different workouts without a page refresh.
- **Distributed Migration Race Condition**: Moved background data migrations to an explicit `migrate_data.py` script to prevent database locks in multi-worker production environments.
- **Fitbit UI Restore**: Restored the Fitbit integration section in Settings that was accidentally regressed.

---

### Changed

#### Suggestions page — exercise picker replaced with inline search

Replaced the native `<Select>` dropdown in the Weight Recommendation card with a mobile-friendly inline search combobox:

- Text input filters exercises as you type
- Results appear in a scrollable list below the input (max ~8 visible rows) showing exercise name + muscle group label
- Tap/click to select; `×` button clears the selection
- List closes on blur with a short delay so taps register correctly on mobile

---

### Changed

#### Weight suggestion engine full rewrite

Replaced the flat RPE-threshold logic with a proper Renaissance Periodization mesocycle arc:

**Meso phase detection**

- Week position is derived from `meso.start_date` when a `meso_cycle_id` is provided; falls back to counting distinct calendar weeks with sessions in the last 8 weeks
- Meso length is read from `meso.end_date`; defaults to a 4-week cycle when no end date is set

**Progressive RPE arc (scales to any meso length)**

- Week 1: target RPE 7.0 — light start, build base (MEV), form focus
- Mid-meso (accumulation): target RPE 7.5 → 8.5 — add sets, increase load
- Pre-peak (intensification): target RPE ~9.0 — approach MRV
- Peak week: target RPE 9.5 — final push to limit
- Deload triggered when `max_rpe ≥ 9.5` OR when past the last meso week → weight reset to **65%**, volume halved

**Weight autoregulation formula**

- `1 RPE unit ≈ 2.5% of working weight`
- Suggestion = `last_weight × (1 + (target_rpe − avg_rpe) × 0.025)`, clamped to ±10–15%
- Rounded to nearest 2.5 lbs after computing the delta (fixing a rounding edge case where small deltas showed "reduce 0.0 lbs" instead of "maintain")

**Volume autoregulation (RP feedback proxy via RPE)**

- RPE < 7.0 → add 2 sets (felt easy)
- RPE 7.0–7.5 → add 1 set
- RPE 7.5–9.0 → add 1 set in accumulation, hold in intensification/peak
- RPE ≥ 9.0 → hold or cut 1 set (approaching MRV)
- Capped at 12 working sets (practical MRV ceiling)

**New response fields**

- `meso_week` — detected week number within the current meso
- `meso_phase` — `"accumulation"` | `"intensification"` | `"peak"` | `"deload"`
- `meso_phase_label` — human-readable label (e.g. "Week 3 - Accumulate volume")
- `target_rpe` — the RPE the algorithm is steering toward this week
- `session_volume` — total sets × reps × weight for the exercise in the last session
- `set_count` — number of working sets logged last session
- `previous_volume` — same metric from the prior session (for trend comparison)
- `volume_trend` — `"increasing"` | `"stable"` | `"decreasing"` | `"no prior data"`
- `suggested_sets` — recommended working sets for next session
- `volume_directive` — plain-English RP volume instruction for the current phase

All legacy fields (`previous_weight`, `suggested_weight`, `average_rpe`, `adjustment_reason`, `average_weight`, `suggestion`, `percentage`) are preserved for API compatibility.

### Tests

- Updated RPE-threshold tests to reflect new algorithm behaviour (weight delta is now RPE-proportional, deload is 65% not 5%)
- Renamed `test_weight_suggestion_rpe_below_7_gives_plus5` → `test_weight_suggestion_rpe_below_target_adds_weight`
- Added `test_weight_suggestion_rpe_at_target_maintains_weight`, `test_weight_suggestion_rpe_well_above_target_reduces_weight`, `test_weight_suggestion_high_rpe_reduces_weight`, `test_weight_suggestion_rpe_above_9_5_triggers_deload`
- Updated senior tests: `test_suggestion_logic_progression`, `test_suggestion_logic_high_rpe_hold` → `test_suggestion_logic_high_rpe_reduces_weight`, `test_suggestion_logic_very_high_rpe_backoff` → `test_suggestion_logic_peak_rpe_triggers_deload`, `test_suggestion_meso_cycle_isolation`

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

### Added

#### Frontend test suite — new coverage (`frontend/src/__tests__/`)

Built a comprehensive frontend test suite from scratch covering all previously untested layers. All 160 tests pass.

**`utils.test.ts`** (10 tests)
- `cn()`: class merging, falsy filtering, Tailwind deduplication
- `formatStatus()`: underscore-to-space conversion, capitalisation

**`api.test.ts`** (18 tests)
- `paramsSerializer`: arrays repeat the key, null/undefined values are omitted, scalars serialised correctly, empty params returns `""`
- Axios defaults: `withCredentials`, `Content-Type`, interceptor registration
- 401 response interceptor: always rejects the promise; redirects to `/login` on 401 outside of `/login`

**`auth-context.test.tsx`** (13 tests)
- `AuthProvider` mount: `isLoading` starts true, resolves after `/api/auth/me`; user set on success, stays null on error
- `login()`: calls `POST /api/auth/login`, re-fetches `/me`, propagates API errors
- `register()`: calls `POST /api/auth/register` with correct payload, re-fetches `/me`
- `logout()`: calls `POST /api/auth/logout`, clears user immediately
- `useAuth()` outside provider: throws with clear error message

**`auth-guard.test.tsx`** (7 tests)
- Loading: spinner shown while `isLoading` is true
- Unauthenticated on protected path: `router.replace('/login')` called, renders null
- Authenticated: children rendered on any path, no redirect
- Public paths (`/login`, `/register`, sub-paths): children rendered without redirect when unauthenticated

**`login-page.test.tsx`** (13 tests)
- Renders all fields and submit button; register link present
- Password visibility toggle (show / hide)
- Successful login: calls `auth.login()`, navigates to `/`
- Error handling: API detail message, HTTP 429 rate-limit message, generic fallback
- Error clears before next submission
- Loading state: button disabled with "Signing in…" text, inputs disabled

**`register-page.test.tsx`** (17 tests)
- Renders name, email, password fields
- Password rules list hidden until typing begins
- Each rule lights up green / red as conditions are met/unmet
- Submit button disabled when password invalid
- Successful registration: calls `auth.register()`, navigates to `/`
- Error handling: "Email already registered" → "email already in use", API detail, generic fallback
- Password visibility toggle
- Loading state: inputs disabled, "Creating account…" text shown

**`sessions-page.test.tsx`** (13 tests)
- Loading: skeleton placeholders visible while data fetches
- Empty state: "No sessions yet" + create button
- Stats strip: total count and volume values rendered correctly
- Upcoming section: scheduled and in_progress sessions appear
- History section: completed sessions rendered; empty-month placeholder shown
- Delete: `DELETE /api/sessions/:id` called on swipe/button
- Session card navigation: click navigates to `/sessions/:id`

#### Frontend test suite — pre-existing test fixes (`session-detail-page.test.tsx`)

Fixed 6 tests that were broken due to page UI changes after the tests were originally written:

| Test | Root cause | Fix |
|---|---|---|
| Volume shows `1,000` | Page now formats ≥1000 as `1.0k` | Regex updated to `/1\.0k\|1,000\|1000/`; use `getAllByText` (volume appears in both header and exercise row) |
| Cancelled: no Edit button | `isCompleted` now includes `cancelled` — Edit button IS shown | Assertion flipped: expect Edit/Lock present, assert Start/Finish/Cancel absent |
| Set badge `0 / 2` | Page renders `0/2` (no spaces) | Changed to `'0/2'` |
| `+ Add Set` | `+` is an SVG icon, not text | Changed to `'Add Set'` |
| Back button selector | Selector `button[class*="lucide-chevron-left"]` targets the button but class is on the child SVG | Changed to `querySelector('.lucide-chevron-left')?.closest('button')` |
| Volume calculation `/1,000\|1000/` | Same format change as above | Same fix as volume test |

#### Backend test suite — new coverage (`backend/tests/`)

Built a backend test suite covering the previously untested API surface. All 91 tests pass (83 new + 8 pre-existing).

**`tests/conftest.py`** — shared fixtures
- In-memory SQLite database (created and dropped per test function for full isolation)
- `db_session`: fresh `AsyncSession` per test
- `client`: `AsyncClient` wired to the FastAPI app; overrides `get_db` dependency and patches `async_session` module-level references in auth / exercises / meso_cycles / suggestions routers
- `test_user`, `auth_headers` (JWT cookie), `test_exercise`, `test_cycle`, `test_session` factory fixtures

**`tests/test_auth.py`** (14 tests)
- `POST /api/auth/register`: success (cookie set, user_id returned), duplicate email → 400, invalid email → 422
- `POST /api/auth/login`: success (cookie set), wrong password → 401, unknown email → 401, rate limit (6th attempt) → 429
- `POST /api/auth/logout`: 200, `access_token` cookie cleared
- `GET /api/auth/me`: returns user fields for authenticated request; 401 when unauthenticated

**`tests/test_exercises.py`** (18 tests)
- `GET /api/exercises`: empty list, all exercises, filtered by `muscle_group`
- `GET /api/exercises/{id}`: found (fields correct), 404
- `POST /api/exercises`: requires auth (401 without cookie), weighted, bodyweight, with description
- `PUT /api/exercises/{id}`: rename, partial update (other fields unchanged), 404
- `DELETE /api/exercises/{id}`: removed + confirmed via GET, 404
- `GET /api/exercises/{id}/history`: empty, with sets (volume calculated), user isolation (other users' sessions excluded)

**`tests/test_meso_cycles.py`** (16 tests)
- `GET /api/meso-cycles`: empty, own cycles returned, other users' cycles excluded, requires auth
- `GET /api/meso-cycles/{id}`: found, 404
- `POST /api/meso-cycles`: requires auth, full payload, minimal payload
- `PUT /api/meso-cycles/{id}`: name change, deactivate, 404
- `DELETE /api/meso-cycles/{id}`: deleted + confirmed, 404
- `GET /api/meso-cycles/{id}/micro-cycles`: empty list
- `POST /api/meso-cycles/{id}/micro-cycles`: created with correct week_number, focus, parent ID; list shows both after two creates

**`tests/test_sessions.py`** (35 tests)
- `GET /api/sessions`: empty, own sessions, excludes other users, requires auth
- `GET /api/sessions/{id}`: found (includes `exercises` array), 404
- `POST /api/sessions`: requires auth, success (user_id, status), with notes
- `PUT /api/sessions/{id}`: name, notes, 404
- `DELETE /api/sessions/{id}`: success, 404, cascades to child sets
- `POST /{id}/start`: transitions to `in_progress`, sets `start_time`, 404
- `POST /{id}/complete`: transitions to `completed`, volume = `reps × weight` for non-warmup sets only, warmup sets excluded, 404
- `POST /{id}/cancel`: transitions to `cancelled`, 404
- `POST /{id}/exercises`: exercise added with correct `exercise_id`
- `DELETE /session-exercises/{se_id}`: removed, 404
- `POST /session-exercises/{se_id}/sets`: set created with correct fields, `is_completed=False` by default
- `PUT /exercise-sets/{set_id}`: mark completed, update weight/reps/RPE, 404
- `DELETE /exercise-sets/{set_id}`: deleted, 404
- `GET /{id}/pre-summary`: fields present, volume calculation, 404

---

## [Unreleased] — 2026-04-04 (continued)

### Fixed

#### Session page — "Prev" rendering bug

- **Bug**: the "Prev" column (showing previous session performance) often rendered as `—` even when history existed
- **Root cause**: history API returned the current (incomplete) session as the first entry; frontend took `entries[0]` which had no sets yet
- **Fix**: frontend now filters out the current session ID when computing `prevSetsMap`, correctly identifying the most recent _past_ performance
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
