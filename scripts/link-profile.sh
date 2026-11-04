#!/usr/bin/env bash
# Link the built dsh-weread package into a running dsh profile.
#
# `dsh plugin add` copies the package (by its `files` allowlist) into the
# profile's node_modules. Because it is a copy, a code change needs a rebuild
# AND a re-link to land in the running profile.
#
# Usage: scripts/link-profile.sh [profile]
#   profile   defaults to $DSH_PROFILE, then `web`
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${1:-${DSH_PROFILE:-web}}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"
DSH_BIN="${DSH_BIN:-$(command -v dsh || true)}"

if [ ! -d "$PROFILE_DIR" ]; then
  echo "no profile at $PROFILE_DIR - start dsh once, or pass the right profile name" >&2
  exit 1
fi
if [ -z "$DSH_BIN" ]; then
  echo "dsh is not on PATH (set DSH_BIN=/path/to/dsh)" >&2
  exit 1
fi
if [ ! -f "$REPO/lib/index.js" ] || [ ! -f "$REPO/lib/client.js" ]; then
  echo "no build - run: node scripts/build.mjs" >&2
  exit 1
fi

echo "==> dsh-weread -> profile '$PROFILE'"
"$DSH_BIN" plugin --profile "$PROFILE" add --save-prod "file:$REPO"

cat <<EON
Linked into profile '$PROFILE' ($PROFILE_DIR).
Turn it on as a bundle: dsh Web GUI -> Settings -> Plugins -> enable "dsh-weread", then reload.
Then open the 设置 tab and paste your WeChat Reading API key (https://weread.qq.com/api/skills/apikeyGet).
EON
