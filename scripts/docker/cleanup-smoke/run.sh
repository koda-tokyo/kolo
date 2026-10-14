#!/usr/bin/env bash
set -euo pipefail

cd /repo

export KOLO_STATE_DIR="/tmp/kolo-test"
export KOLO_CONFIG_PATH="${KOLO_STATE_DIR}/kolo.json"

echo "==> Build"
pnpm build

echo "==> Seed state"
mkdir -p "${KOLO_STATE_DIR}/credentials"
mkdir -p "${KOLO_STATE_DIR}/agents/main/sessions"
echo '{}' >"${KOLO_CONFIG_PATH}"
echo 'creds' >"${KOLO_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${KOLO_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm KoLo reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${KOLO_CONFIG_PATH}"
test ! -d "${KOLO_STATE_DIR}/credentials"
test ! -d "${KOLO_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${KOLO_STATE_DIR}/credentials"
echo '{}' >"${KOLO_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm KoLo uninstall --state --yes --non-interactive

test ! -d "${KOLO_STATE_DIR}"

echo "OK"
