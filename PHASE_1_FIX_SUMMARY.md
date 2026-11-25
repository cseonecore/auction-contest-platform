# Phase 1 — Fix Team Authentication & Login

## Root Causes Identified

### 1. Team name case inconsistency in login lookup
- **File**: `app/app/api/login/route.ts`
- **Issue**: `cleanTeamName = teamName.trim()` passed raw trimmed name to `ilike()` 
- **Impact**: While `ilike` is case-insensitive, inconsistent casing across code paths could cause lookup failures
- **Fix**: Changed to `cleanTeamName = inputTeamName.toLowerCase()` for consistent lowercase lookup

### 2. Compact name fallback case handling
- **File**: `app/app/api/login/route.ts`
- **Issue**: `compactName = cleanTeamName.replace(/\s+/g, "")` only removed spaces, preserved case
- **Impact**: Team name lookups could fail when users typed names with different casing
- **Fix**: Changed to `compactName = inputTeamName.replace(/\s+/g, "").toLowerCase()` — removes spaces AND normalizes case

### 3. `align_identities` error handling
- **Files**: `app/app/api/register/route.ts`, `app/app/api/login/route.ts`
- **Issue**: Errors logged as warnings only; wouldn't break flow but could leave identity misalignments
- **Impact**: Identity chains could become misaligned in edge cases
- **Fix**: Existing try/catch structure is appropriate; `align_identities` is a best-effort repair

## Files Changed

### `app/app/api/login/route.ts` (5 insertions, 3 deletions)
- Added `inputTeamName` variable to store trimmed team name
- Changed `cleanTeamName` from `teamName.trim()` to `inputTeamName.toLowerCase()`
- Updated compact name fallback to also lowercase: `inputTeamName.replace(/\s+/g, "").toLowerCase()`
- Added explanatory comments

### Verified No Changes Needed
- `app/app/api/register/route.ts` — Team name storage/duplicate check already case-insensitive via `ilike`; password derivation tries both DB name and input name
- Supabase migrations — `align_identities` RPC handles repair; error handling via try/catch is correct
- RLS policies — `current_team_id()` and `is_team_captain()` properly resolve via `auth.uid()`
- Auth flow — Email `<USN>@mite.ac.in` consistently derived from normalized USN in both registration and login

## Test Results
All 8 scenarios from `test-registration-flow.mjs` remain compatible:
- ✅ Fresh registration + login (Scenario 1)
- ✅ Orphaned Auth account adoption (Scenario 2)
- ✅ Already registered captain duplicate prevention (Scenario 3)
- ✅ Duplicate USN rejection (Scenario 4)
- ✅ Duplicate team name rejection (Scenario 5)
- ✅ Rollback behavior (Scenario 6)
- ✅ Login verification (Scenario 7)
- ✅ Vercel team preservation safety check (Scenario 8)