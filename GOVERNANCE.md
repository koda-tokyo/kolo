# Governance

This page says who decides what in the KoLo project and how a decision is made. It is deliberately short; the rules that keep the product shippable are in `AGENTS.md`, the licensing map in `LICENSING.md`, the contribution process in `CONTRIBUTING.md`.

## Roles

| Role         | Who                                                                              | What they decide                                                      |
| ------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Owner        | KODA Group (KODA Intelligent Systems)                                            | licensing, trademarks, releases, the proprietary layer, this document |
| Maintainers  | the KODA Group engineering staff listed in `CONTRIBUTORS.md` under "maintainers" | what merges to `main`, the roadmap, versioning, security response     |
| Contributors | anyone who has signed the CLA and had a change merged                            | propose changes, review, triage                                       |
| Users        | anyone running the product                                                       | report problems, request features, vote in discussions                |

There is one maintainer team. Maintainers are appointed by the owner from contributors with a record of merged changes and reviews; the list is the only authoritative source.

## How decisions are made

1. **Default: the maintainer on duty decides.** Small changes (bug fixes, documentation, tests, additive flags) are merged by any maintainer after review. No vote.
2. **Design changes go through a discussion first.** Anything that adds a command group, a config section, a route, a protocol method, a storage format or a dependency opens a GitHub discussion (category _Ideas_) or an issue with the feature form. A maintainer answers with one of: _accepted_, _accepted with changes_, _needs a design note_, _declined_, with the reason. Silence for 14 days means _declined for now_; reopen with new information.
3. **Breaking changes need two maintainers.** A change that alters an exit code, removes a flag or command, changes a config key without migration, or changes the wire protocol in a non-additive way needs an explicit approval from two maintainers and an entry under _Upgrade notes_ in the release.
4. **Security decisions are not public until the fix ships.** Reports follow `SECURITY.md`; the maintainers decide severity and timing; disclosure is coordinated with the reporter.
5. **The owner decides licensing, trademarks and the proprietary layer.** These are not subject to community vote. Pull requests against the proprietary layer are accepted only from KODA staff under agreement.
6. **Disagreements** between maintainers are resolved by the owner. The decision and its reason are recorded in the discussion or issue.

Decisions are recorded where they are made (issue, discussion, pull request). Significant ones are summarised in `ROADMAP.md` or in the release notes.

## Roadmap

`ROADMAP.md` is public and lists directions by quarter, not dates. Items move when they ship, not when they are promised. A roadmap entry is not a commitment to a deadline; a release note is a record of what shipped.

## Releases

Maintainers cut releases from `main` following `docs/reference/RELEASING.md`. Release notes use `.github/release-notes-template.md`. Security fixes go to the latest stable and the latest beta (`SECURITY.md`).

## Contributor License Agreement

Every contribution requires the CLA in `CLA.md`, signed by `Signed-off-by` on each commit (`git commit -s`). Contributors keep their copyright; the owner receives a licence that allows the open-core model in `LICENSING.md` to continue. The first contribution from a new signer is recorded in `CONTRIBUTORS.md` by a maintainer.

## Code of conduct

Maintainers enforce `CODE_OF_CONDUCT.md`. Reports go to the address in that file; the owner is the escalation point.

## Changing this document

Changes to this page are proposed as pull requests and need the owner's approval.
