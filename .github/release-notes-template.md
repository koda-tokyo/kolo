<!-- Release notes template. Copy into CHANGELOG.md under the version heading and into the GitHub release. Keep the section order; delete empty sections. Voice: docs/CLI_STYLE.md. -->

## <version> (<YYYY-MM-DD>)

One or two sentences: what this release is for and who should upgrade.

### Upgrade notes

- Breaking changes, config migrations (`kolo doctor --fix` handles: …), new minimum versions.
- Exit code or output changes that scripts may depend on.

### Added

- `kolo <command>`: what it does (docs: /path).
- Config key `section.key`: what it controls and the default.

### Changed

- Behaviour changes with the old and the new behaviour stated.

### Fixed

- Symptom as the user saw it, then the cause in one clause.

### Security

- Fixes to the gateway, CLI, pairing, secrets store, audit log, integrity gate or install scripts. Credit the reporter unless they asked not to be named. Reference the advisory.

### Documentation

- Pages added or rewritten.

### Verification

- `pnpm check`, `pnpm test`, `pnpm smoke`, `pnpm release:check`, `pnpm pack:check` on <OS list>.
- Bundle checksums are in `SHA256SUMS` next to the assets; the installer verifies them.
