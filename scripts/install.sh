#!/usr/bin/env bash
# KoLo installer for Linux and macOS.
#
#   curl -fsSL https://kodasoken.com/kurahi/install.sh | bash
#   curl -fsSL https://kodasoken.com/kurahi/install.sh | bash -s -- --version 2.0.0 --no-service
#
# What it does:
#   1. Picks the release bundle for this OS and CPU from GitHub Releases
#      (kolo-<version>-<os>-<arch>.tar.gz built by scripts/bundle.mjs, with SHA256SUMS.txt
#      next to it; see docs/PACKAGING.md for the layout: bin/kolo, node/, lib/, SHA256SUMS,
#      bundle-manifest.json).
#   2. Verifies the SHA-256 of the download against SHA256SUMS.txt before unpacking.
#   3. Installs under $KOLO_INSTALL_DIR (default ~/.local/share/kolo/<version>) and links
#      ~/.local/bin/kolo (or $KOLO_BIN_DIR/kolo).
#   4. Runs `kolo init --non-interactive` and `kolo service install` unless told not to.
#   5. Prints a pairing invitation for a second device or terminal.
#
# Requirements: bash, curl, tar, sha256sum or shasum. The bundle ships its own Node.js runtime,
# so nothing has to be on PATH. Nothing is downloaded from anywhere but github.com, and nothing
# runs as root.
set -euo pipefail

REPO="koda-tokyo/kurahi"
API="https://api.github.com/repos/${REPO}/releases"
DOWNLOAD="https://github.com/${REPO}/releases/download"
DOCS="https://kurahi.kodasoken.com/docs"

VERSION=""
PREFIX="${KOLO_INSTALL_DIR:-$HOME/.local/share/kolo}"
BIN_DIR="${KOLO_BIN_DIR:-$HOME/.local/bin}"
BUNDLE_FILE=""
SUMS_FILE=""
DO_INIT=1
DO_SERVICE=1
DO_INVITE=1
DRY_RUN=0
IDENTITY="${KOLO_IDENTITY:-default}"

usage() {
  cat <<EOF
KoLo installer

Usage: install.sh [options]

Options:
  --version <v>       Install this release instead of the latest (e.g. 2.0.0)
  --prefix <dir>      Install directory (default: $PREFIX)
  --bin-dir <dir>     Where the kolo command is linked (default: $BIN_DIR)
  --bundle <file>     Install from a local bundle instead of downloading
  --sums <file>       Checksum file to verify a local bundle against (SHA256SUMS.txt or the
                      bundle's .sha256 sibling; default: either one next to the bundle)
  --name <id>         Identity name for the first run (default: $IDENTITY)
  --no-init           Do not run kolo init
  --no-service        Do not register the gateway as an OS service
  --no-invite         Do not print a pairing invitation
  --dry-run           Resolve the asset and print what would happen; download nothing
  -h, --help          This text

Environment: KOLO_INSTALL_DIR, KOLO_BIN_DIR, KOLO_IDENTITY, KOLO_HOME (state directory).
Docs: $DOCS/install
EOF
}

log() { printf '%s\n' "$*"; }
die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --version=*) VERSION="${1#*=}"; shift ;;
    --prefix) PREFIX="${2:-}"; shift 2 ;;
    --bin-dir) BIN_DIR="${2:-}"; shift 2 ;;
    --bundle) BUNDLE_FILE="${2:-}"; shift 2 ;;
    --sums) SUMS_FILE="${2:-}"; shift 2 ;;
    --name) IDENTITY="${2:-}"; shift 2 ;;
    --no-init) DO_INIT=0; shift ;;
    --no-service) DO_SERVICE=0; shift ;;
    --no-invite) DO_INVITE=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] && [ -z "${KOLO_ALLOW_ROOT:-}" ] && die "do not run as root; install as the user that will run the gateway (set KOLO_ALLOW_ROOT=1 to override)"

need() { command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1"; }
need curl
need tar

case "$(uname -s)" in
  Linux) OS="linux" ;;
  Darwin) OS="darwin" ;;
  *) die "unsupported OS: $(uname -s). Windows users: https://kodasoken.com/kurahi/install.ps1" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) die "unsupported CPU: $(uname -m)" ;;
esac

if command -v sha256sum >/dev/null 2>&1; then
  SHA="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA="shasum -a 256"
else
  die "need sha256sum or shasum to verify the download"
fi

resolve_version() {
  if [ -n "$VERSION" ]; then
    VERSION="${VERSION#v}"
    return
  fi
  local tag
  tag="$(curl -fsSL -H 'Accept: application/vnd.github+json' "${API}/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"
  [ -n "$tag" ] || die "could not resolve the latest release from ${API}/latest"
  VERSION="${tag#v}"
}

ASSET=""
TMP=""
# Must return 0 on an empty TMP: a failing `[ -n ]` in the EXIT trap makes the whole script
# exit 1 under `set -e` (the --dry-run and --help paths never create TMP).
cleanup() { if [ -n "$TMP" ]; then rm -rf "$TMP"; fi; }
trap cleanup EXIT

verify() {
  local file="$1" sums="$2"
  local expected actual
  expected="$(grep -E "[[:space:]]\*?$(basename "$file")\$" "$sums" | awk '{print $1}' | head -n1)"
  [ -n "$expected" ] || die "$(basename "$file") is not listed in $(basename "$sums")"
  actual="$($SHA "$file" | awk '{print $1}')"
  [ "$expected" = "$actual" ] || die "SHA-256 mismatch for $(basename "$file"): expected $expected, got $actual"
  log "sha256 ok  $actual"
}

main() {
  if [ -n "$BUNDLE_FILE" ]; then
    [ -f "$BUNDLE_FILE" ] || die "bundle not found: $BUNDLE_FILE"
    ASSET="$(basename "$BUNDLE_FILE")"
    VERSION="$(printf '%s' "$ASSET" | sed -n 's/^kolo-\(.*\)-\(linux\|darwin\)-\(x64\|arm64\)\.tar\.gz$/\1/p')"
    [ -n "$VERSION" ] || die "bundle name must look like kolo-<version>-<os>-<arch>.tar.gz"
  else
    resolve_version
    ASSET="kolo-${VERSION}-${OS}-${ARCH}.tar.gz"
  fi
  local dest="${PREFIX}/${VERSION}"

  log "KoLo ${VERSION}  ${OS}/${ARCH}"
  log "asset      ${ASSET}"
  log "install    ${dest}"
  log "command    ${BIN_DIR}/kurahi (alias: kolo)"
  if [ "$DRY_RUN" -eq 1 ]; then
    log "source     ${BUNDLE_FILE:-${DOWNLOAD}/v${VERSION}/${ASSET}}"
    log "dry run: nothing downloaded, nothing written"
    return 0
  fi

  TMP="$(mktemp -d)"
  local bundle sums
  if [ -n "$BUNDLE_FILE" ]; then
    bundle="$BUNDLE_FILE"
    if [ -n "$SUMS_FILE" ]; then
      sums="$SUMS_FILE"
    elif [ -f "${BUNDLE_FILE}.sha256" ]; then
      sums="${BUNDLE_FILE}.sha256"
    else
      sums="$(dirname "$BUNDLE_FILE")/SHA256SUMS.txt"
    fi
    [ -f "$sums" ] || die "no checksum file next to the bundle (${ASSET}.sha256 or SHA256SUMS.txt; pass --sums)"
  else
    bundle="${TMP}/${ASSET}"
    sums="${TMP}/SHA256SUMS.txt"
    log "download   ${DOWNLOAD}/v${VERSION}/${ASSET}"
    curl -fL --progress-bar -o "$bundle" "${DOWNLOAD}/v${VERSION}/${ASSET}"
    curl -fsSL -o "$sums" "${DOWNLOAD}/v${VERSION}/SHA256SUMS.txt"
  fi
  verify "$bundle" "$sums"

  mkdir -p "$PREFIX" "$BIN_DIR"
  rm -rf "${dest}.partial"
  mkdir -p "${dest}.partial"
  tar -xzf "$bundle" -C "${dest}.partial" --strip-components=1
  [ -x "${dest}.partial/bin/kolo" ] || die "bundle has no bin/kolo"
  [ -f "${dest}.partial/bundle-manifest.json" ] || die "bundle has no bundle-manifest.json (not a scripts/bundle.mjs bundle)"
  if [ -f "${dest}.partial/SHA256SUMS" ]; then
    (cd "${dest}.partial" && $SHA -c SHA256SUMS >/dev/null) || die "bundle contents fail their SHA256SUMS"
    log "bundle contents ok"
  fi
  rm -rf "$dest"
  mv "${dest}.partial" "$dest"
  ln -sfn "$dest" "${PREFIX}/current"
  ln -sfn "${PREFIX}/current/bin/kolo" "${BIN_DIR}/kolo"
  # `kurahi` is the command; bundles before 2.0.1 ship only bin/kolo, so link to that.
  ln -sfn "${PREFIX}/current/bin/kolo" "${BIN_DIR}/kurahi"
  log "installed  $("${BIN_DIR}/kurahi" --version)"

  case ":$PATH:" in
    *":${BIN_DIR}:"*) ;;
    *) log ""; log "add ${BIN_DIR} to PATH, for example:"; log "  export PATH=\"${BIN_DIR}:\$PATH\"" ;;
  esac

  local kolo="${BIN_DIR}/kurahi"
  if [ "$DO_INIT" -eq 1 ]; then
    log ""
    "$kolo" init --non-interactive --name "$IDENTITY" --bind loopback || die "kolo init failed"
  fi
  if [ "$DO_SERVICE" -eq 1 ]; then
    log ""
    if "$kolo" service install --id "$IDENTITY"; then
      :
    else
      log "service install did not complete; start the gateway in a terminal with: kolo gateway"
      DO_INVITE=0
    fi
  fi
  if [ "$DO_SERVICE" -eq 0 ]; then
    DO_INVITE=0
    log ""
    log "no service registered: start the gateway with 'kolo gateway', then run 'kolo pair invite --scope attach'"
  fi
  if [ "$DO_INVITE" -eq 1 ]; then
    log ""
    log "pairing invitation (scope: attach, one use):"
    "$kolo" pair invite --scope attach || log "run 'kolo pair invite --scope attach' once the gateway is up"
  fi
  log ""
  log "next: kurahi health · kurahi tui · kurahi --help · ${DOCS}/start/getting-started"
}

main "$@"
