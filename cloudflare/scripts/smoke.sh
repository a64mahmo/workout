#!/usr/bin/env bash
# End-to-end smoke test against a running Worker (default: local `wrangler dev`).
#   BASE=https://workout-tracker.example.workers.dev npm run smoke
set -euo pipefail
BASE="${BASE:-http://localhost:8787}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
EMAIL="smoke-$(date +%s)-$RANDOM@example.com"
fail() { echo "FAIL: $*" >&2; exit 1; }
req() { # method path [json]
  local out code
  out=$(curl -sS -b "$JAR" -c "$JAR" -X "$1" "$BASE$2" -H 'Content-Type: application/json' ${3:+-d "$3"} -w $'\n%{http_code}')
  code="${out##*$'\n'}"; BODY="${out%$'\n'*}"; STATUS="$code"
}
expect() { [ "$STATUS" = "$1" ] || fail "$2: expected $1 got $STATUS: $BODY"; echo "ok  $2"; }
jget() { python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(eval(sys.argv[2]))" "$BODY" "$1"; }

req GET /api/health; expect 200 health
req GET /api/auth/me; expect 401 "me without cookie"
req POST /api/auth/register "{\"email\":\"$EMAIL\",\"name\":\"Smoke\",\"password\":\"pw123456\"}"; expect 200 register
req POST /api/auth/register "{\"email\":\"$EMAIL\",\"name\":\"Smoke\",\"password\":\"x\"}"; expect 400 "duplicate register"
req POST /api/auth/register '{"email":"not-an-email","name":"x","password":"x"}'; expect 422 "invalid email"
req POST /api/auth/logout; expect 200 logout
req POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"wrong\"}"; expect 401 "bad password"
req POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"pw123456\"}"; expect 200 login
req GET /api/auth/me; expect 200 me
[ "$(jget 'd["email"]')" = "$EMAIL" ] || fail "me email"

req GET /api/plans; expect 200 "list plans (seeded)"
[ "$(jget 'len(d[0]["plan_sessions"])')" = "52" ] || fail "seeded plan should have 52 sessions"
PS_ID=$(jget 'd[0]["plan_sessions"][0]["id"]')
EX_ID=$(jget 'd[0]["plan_sessions"][0]["exercises"][0]["exercise_id"]')
req GET /api/plans/progress; expect 200 "plan progress"
req GET "/api/plans/plan-sessions/$PS_ID/preview"; expect 200 "plan session preview"

req POST /api/meso-cycles '{"name":"Meso 1","start_date":"2026-10-01","end_date":"2026-11-01"}'; expect 200 "create meso"
MESO=$(jget 'd["id"]')
req POST "/api/sessions" "{\"name\":\"Day 1\",\"meso_cycle_id\":\"$MESO\",\"scheduled_date\":\"2026-10-05\"}"; expect 200 "create session"
SID=$(jget 'd["id"]')
req POST "/api/plans/plan-sessions/$PS_ID/apply" "{\"training_session_id\":\"$SID\",\"overrides\":[]}"; expect 200 "apply plan session"
req GET "/api/sessions/$SID"; expect 200 "get session"
[ "$(jget 'd["plan_session_id"]')" = "$PS_ID" ] || fail "plan_session_id not recorded"
SET_ID=$(jget 'd["exercises"][0]["sets"][0]["id"]')
req POST "/api/sessions/$SID/start"; expect 200 "start session"
req PUT "/api/sessions/exercise-sets/$SET_ID" '{"weight":225,"reps":5,"rpe":8,"is_completed":true}'; expect 200 "complete a set"
[ "$(jget 'd["is_completed"]')" = "True" ] || fail "set not completed"
req GET "/api/sessions/$SID/pre-summary"; expect 200 "pre-summary"
[ "$(jget 'len(d["prs"])')" = "1" ] || fail "expected 1 PR: $BODY"
req POST "/api/sessions/$SID/complete"; expect 200 "complete session"
[ "$(jget 'd["total_volume"]')" = "1125" ] || fail "volume should be 1125: $BODY"

req GET "/api/suggestions/weight?exercise_id=$EX_ID&session_id=$SID"; expect 200 "weight suggestion"
[ -n "$(jget 'd["prediction_source"]')" ] || fail "prediction_source missing"; echo "    prediction_source=$(jget 'd["prediction_source"]') suggested=$(jget 'd["suggested_weight"]')"
LOG_ID=$(jget 'd["log_id"]')
req PATCH "/api/suggestions/weight/history/$LOG_ID" '{"actual_weight":230}'; expect 200 "record outcome"
req GET "/api/suggestions/weight/history"; expect 200 "suggestion history"
req GET /api/suggestions/exercises; expect 200 "exercise suggestions"
req GET /api/suggestions/muscle-groups; expect 200 "muscle groups"
req GET "/api/exercises/$EX_ID/history"; expect 200 "exercise history"
[ "$(jget 'd[0]["total_volume"]')" = "1125" ] || fail "history volume: $BODY"
req GET "/api/exercises/$EX_ID/history?limit=99"; expect 422 "history limit validation"
req POST /api/sessions/sync-volume; expect 200 "sync volume"
req GET /api/sessions; expect 200 "list sessions"
req DELETE "/api/sessions/$SID"; expect 200 "delete session"
req GET "/api/sessions/$SID"; expect 404 "deleted session gone"
req DELETE "/api/meso-cycles/$MESO"; expect 200 "delete meso"
req GET /api/fitbit/status; expect 200 "fitbit status"
req GET /api/plans/templates; expect 200 "templates"

# Static frontend + dynamic-route fallback
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/sessions/$SID"); [ "$code" = 200 ] || fail "dynamic route page: $code"; echo "ok  /sessions/<id> serves placeholder page"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/sessions/$SID.txt"); [ "$code" = 200 ] || fail "dynamic route RSC payload: $code"; echo "ok  /sessions/<id>.txt serves placeholder payload"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/login"); [ "$code" = 200 ] || fail "login page: $code"; echo "ok  /login"
echo "ALL SMOKE TESTS PASSED"
