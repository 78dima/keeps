#!/usr/bin/env bash
# Publish the prepared build branch, wait for GitHub Actions, and download its APK.
set -euo pipefail
MONOKEEP_APP=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
MONOKEEP_REPO=$(git -C "$MONOKEEP_APP" rev-parse --show-toplevel)
cd "$MONOKEEP_REPO"
MONOKEEP_BRANCH=codex/android-apk
if [[ "$(git branch --show-current)" != "$MONOKEEP_BRANCH" ]]; then
  echo "Switch to the prepared $MONOKEEP_BRANCH branch before running this script." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain -- apps/android .github/workflows/android.yml)" ]]; then
  echo 'Commit Android/workflow changes before starting a build, so the APK matches the local source.' >&2
  exit 1
fi
if ! command -v gh >/dev/null; then
  echo 'GitHub CLI (gh) is required. Flutter and Android SDK are not required locally.' >&2
  exit 1
fi
MONOKEEP_REPOSITORY=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
MONOKEEP_COMMIT=$(git rev-parse HEAD)
git push --set-upstream origin "$MONOKEEP_BRANCH"

MONOKEEP_RUN=''
for MONOKEEP_ATTEMPT in {1..30}; do
  MONOKEEP_RUN=$(gh run list --repo "$MONOKEEP_REPOSITORY" --branch "$MONOKEEP_BRANCH" \
    --commit "$MONOKEEP_COMMIT" --event push --limit 10 --json databaseId,workflowName \
    --jq '[.[] | select(.workflowName == "MonoKeep Android APK")][0].databaseId // empty')
  if [[ -n "$MONOKEEP_RUN" ]]; then break; fi
  sleep 2
done
if [[ -z "$MONOKEEP_RUN" ]]; then
  echo "No build appeared for commit $MONOKEEP_COMMIT. Check that Actions is enabled in $MONOKEEP_REPOSITORY." >&2
  exit 1
fi
gh run view "$MONOKEEP_RUN" --repo "$MONOKEEP_REPOSITORY" --json url --jq '.url'
if ! gh run watch "$MONOKEEP_RUN" --repo "$MONOKEEP_REPOSITORY" --interval 10 --exit-status; then
  gh run view "$MONOKEEP_RUN" --repo "$MONOKEEP_REPOSITORY" --log-failed
  exit 1
fi
MONOKEEP_OUTPUT="$MONOKEEP_APP/dist/cloud-$MONOKEEP_RUN"
mkdir -p "$MONOKEEP_OUTPUT"
if [[ ! -f "$MONOKEEP_OUTPUT/monokeep-release.apk" || ! -f "$MONOKEEP_OUTPUT/monokeep-release.apk.sha256" ]]; then
  gh run download "$MONOKEEP_RUN" --repo "$MONOKEEP_REPOSITORY" \
    --name monokeep-android-release --dir "$MONOKEEP_OUTPUT"
fi
python3 - "$MONOKEEP_OUTPUT" <<'PY'
import hashlib, pathlib, sys
directory = pathlib.Path(sys.argv[1])
apk = directory / 'monokeep-release.apk'
checksum = (directory / 'monokeep-release.apk.sha256').read_text().split()[0]
if hashlib.sha256(apk.read_bytes()).hexdigest() != checksum:
    raise SystemExit('APK checksum mismatch')
print(f'APK downloaded and verified: {apk}')
PY
