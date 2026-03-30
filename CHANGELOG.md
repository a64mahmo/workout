# Changelog

All notable changes to this project are documented here.

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
