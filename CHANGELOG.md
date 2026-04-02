# Changelog

All notable changes to this project are documented here.

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
