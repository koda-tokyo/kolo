---
summary: "The factory: a goal in, a reviewed pull request out, visible as a board where every card carries its evidence"
read_when:
  - You want a resident to turn goals into pull requests without watching every step
  - You are connecting the gateway to the KIP headless engine
  - You need to know who may move, run, merge or only read a card
title: "The factory"
---

# The factory

The factory is a board. A card is one goal for one repository, owned by one resident. The card
moves through fixed columns as the work happens:

```
inbox → spec → build → review → ready → merged
                                  ↘ failed (→ inbox to retry)
```

Nothing moves a card silently. Every transition is checked by a state machine, written to the
[audit chain](/cli/security) and shown on the card's timeline with who caused it (a resident, an
owner or device credential, the runner, or the engine). A run is a [job](/cli/jobs) of kind
`factory`, so its [evidence log](/evidence) is recorded, signed and linked from the card.

## Concepts

| Term         | Meaning                                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Board        | A named list of cards with an optional default repository. Boards live under `KOLO_HOME/factory/<board>/`.                                                                                                           |
| Card         | goal, repository (absolute path of a git checkout on the gateway host), owner resident, column, policy, timeline, linked engine task, jobs, evidence ids, branch and pull request.                                   |
| Run          | One execution of the card on the KIP engine: a job, an engine task, an evidence log. A card can be run from `inbox` or `failed`; a retry moves it back to `inbox` first.                                             |
| Policy       | `autoMerge` (default off). With it on, the runner merges through the engine when the result is ready **and** the merge permission is held. Without it the card stops at `ready`.                                     |
| Pull request | Opened on `ready` when `factory.github.enabled` is true (the engine's branch is pushed and `gh pr create` runs in the repository). Otherwise the ready branch is left in the repository and its name is on the card. |

### Columns and the engine

The runner maps the engine's task status to a column and walks the forward path, one audited move
at a time: `spec` → `spec`; `planning`, `coding`, `merging` → `build`; `qa` → `review`;
`ready_to_merge` → `ready`; `merged` → `merged`; `failed`, `cancelled` → `failed`. The timeline
keeps every engine event (status, phase, log, tool, progress, error, done) as one line with its
bounded payload; the job's evidence log keeps the same events as `tool.result` entries under one
`kip_engine_task` call, so an auditor can replay the run offline with `kurahi evidence replay`.

## Setup

1. Run the KIP headless engine on the gateway host, bound to loopback, with a token file:

   ```bash
   kip-engine serve --port 18990 --token-file ~/.kip-engine/token
   ```

2. Point the gateway at it and name a default repository:

   ```json5
   {
     kipEngine: {
       enabled: true,
       baseUrl: "http://127.0.0.1:18990",
       tokenFile: "/home/alice/.kip-engine/token",
     },
     factory: {
       defaultRepo: "/srv/app",
       github: { enabled: true, remote: "origin", base: "main" },
     },
   }
   ```

   `kipEngine.taskTimeoutMs` caps one run (default 30 minutes). The engine's token file is read per
   run; it never appears in `kolo.json`, on argv or in logs.

3. Create a card and run it:

   ```bash
   kurahi factory create --goal "Add a /health endpoint with a test" --run
   kurahi factory cards
   kurahi factory show <card id>
   ```

   The board is also at `/factory` on the gateway (see below) and as `/factory` in the TUI.

Without `kipEngine` configured the board still works: cards can be created, commented on and
moved by hand; `run` answers `409 not_configured`.

### Config reference

| Key                          | Default                       | Meaning                                                                                           |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `factory.enabled`            | `true`                        | Master switch for the API, the tools and the page.                                                |
| `factory.defaultBoard`       | `main`                        | Board for cards created without one.                                                              |
| `factory.defaultRepo`        | none                          | Repository for cards and boards that name none.                                                   |
| `factory.github.enabled`     | `false`                       | Open a pull request on `ready`. Needs `git` and `gh` on `PATH`, authenticated for the repository. |
| `factory.github.remote`      | `origin`                      | Remote the branch is pushed to.                                                                   |
| `factory.github.base`        | the engine task's base branch | Base branch of the pull request.                                                                  |
| `factory.github.draft`       | `false`                       | Open as a draft.                                                                                  |
| `factory.policy.autoMerge`   | `false`                       | Default policy for new cards (a card may set its own).                                            |
| `factory.maxTimelineEntries` | `500`                         | Timeline entries kept per card.                                                                   |

## Who may do what

| Action                   | Through tools (a resident)                                 | Through the API, CLI or Kanban                                                                       |
| ------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Read boards and cards    | `factory_card_comment` with no card id lists cards         | `attach` scope or above                                                                              |
| Create a card            | `factory_card_create` — needs `exec:factory_card:create`   | `admin` or owner                                                                                     |
| Move a card              | `factory_card_move` — needs `exec:factory_card:move`       | `admin` or owner                                                                                     |
| Comment                  | `factory_card_comment` — needs `exec:factory_card:comment` | timeline is read-only on the page                                                                    |
| Run, cancel              | not a tool                                                 | `admin` or owner                                                                                     |
| Merge through the engine | never directly                                             | only the runner, and only when the card policy says `autoMerge` **and** the merge permission is held |

The three tools are classified under the `exec` [permission class](/agents-permissions), so they
are deny-by-default once an agent has any rule. `exec:factory_card:*` grants all three;
`exec:factory_card:comment` grants only comments.

The **merge permission** is the same rule the `kip_engine_task` tool uses: a rule matching
`kip_engine_task:merge` (for example `exec:kip_engine_task:merge`) in the owner resident's
`agents.list[].permissions`. When a run is started by an owner credential with `merge: true`
(`kurahi factory run <id> --merge`), the gate is allowed for that run; a pairing credential can
never widen it. A card whose policy asks for auto-merge but whose owner lacks the rule stays at
`ready` with a timeline entry saying why, and the audit chain records `factory.merge.denied`.

A manual move from `ready` to `merged` records that the owner merged the result outside the
engine (for example the pull request was merged on the forge); it does not call the engine.

## The Kanban

`GET /factory` serves a static page with no data in it. It takes the gateway token or a pairing
access token from the URL fragment (`/factory#token=…`, which never reaches the server) or from a
prompt, keeps it in the tab's memory, reads `GET /api/factory/boards` and `GET /api/factory/cards`
(attach scope) and follows `factory.card` events on the WebSocket, so a card moves on the board as
the engine reports progress.

Selecting a card shows its goal, repository, branch, pull request, policy, error, the evidence
summary of each job (events, tool calls, signed) with an **open evidence** link that renders
`GET /evidence/<jobId>` with the same token, and the full timeline. **Run**, **Cancel run** and
**move to…** call the admin routes; a credential below admin sees them refused with a clear
message. The page uses light mode, SVG icons and no external assets; its CSP allows only inline
script and style and same-origin connections.

The TUI prints the board as a table with `/factory [board]` and one card with `/factory show
<card id>`.

## API

| Operation           | Route                                                                               | Scope  |
| ------------------- | ----------------------------------------------------------------------------------- | ------ |
| `listFactoryBoards` | `GET /api/factory/boards`                                                           | attach |
| `listFactoryCards`  | `GET /api/factory/cards?board=&column=&owner=&limit=`                               | attach |
| `createFactoryCard` | `POST /api/factory/cards` `{goal, title?, repo?, board?, owner?, autoMerge?, run?}` | admin  |
| `getFactoryCard`    | `GET /api/factory/cards/{id}` (with timeline, `running`)                            | attach |
| `moveFactoryCard`   | `POST /api/factory/cards/{id}/move` `{to, reason?}` — 409 when the machine refuses  | admin  |
| `runFactoryCard`    | `POST /api/factory/cards/{id}/run` `{profile?, merge?}` — 409 when not startable    | admin  |
| `cancelFactoryCard` | `POST /api/factory/cards/{id}/cancel`                                               | admin  |
| `getFactoryView`    | `GET /factory` (HTML shell)                                                         | none   |

`factory.card` WebSocket events carry `{kind, card, from?, to?, entry?}` for `card.created`,
`card.moved` and `card.updated`, and `{kind: "board.created", board}`.

## CLI

```bash
kurahi factory boards                         # card counts per column
kurahi factory cards [--board id] [--column ready] [--owner alice]
kurahi factory create --goal "…" [--repo /srv/app] [--title t] [--board id] [--owner id] [--auto-merge] [--run]
kurahi factory show <card id>                 # facts, jobs, evidence links, last timeline entries
kurahi factory move <card id> <column> [--reason "…"]
kurahi factory run <card id> [--profile p] [--merge]
kurahi factory cancel <card id>
```

Every command takes `--json`. Exit codes: 0 ok, 1 the gateway refused (for example an illegal
move), 2 usage, 3 gateway unreachable, 4 the credential may not do this.

## Pull request flow

1. The engine reports `ready_to_merge` with its branch (`kip/<specId>`) in the repository.
2. The card reaches `ready`. With `factory.github.enabled`, the runner runs `git push -u <remote>
<branch>` and then `gh pr create --head <branch> [--base <base>] [--draft] --title <card title>
--body <goal + card id + engine task + summary>` in the repository, and records the URL and
   number on the card (`pr`). A failure is written to the timeline and the card stays `ready` with
   the branch name; nothing is retried on its own.
3. With `autoMerge` and the merge permission, the runner calls the engine's merge with
   `commit: true` and moves the card to `merged`. Otherwise the owner reviews the pull request and
   moves the card to `merged` by hand once it is in.

## Verification

`pnpm factory:check` builds nothing itself; after `pnpm build` it runs
`src/factory/factory.e2e.test.ts` against a throwaway gateway and a fake engine: one card created
through the API, run, followed over the WebSocket (`inbox>spec`, `spec>build`, `build>review`,
`review>ready`), its job (`kind: factory`, `succeeded`) and signed evidence read back, the Kanban
page served without data, an illegal move refused with 409, a manual move to `merged` audited, and
the same board read through `kurahi factory boards|show|cards`. It honours `KOLO_SMOKE_HOME` (a
path ending in `.kolo-test`) and `KOLO_SMOKE_PORT`.

What the fake engine cannot prove: a real spec, build and QA on a repository, a real `gh` pull
request, and a real merge. Run those once against `kip-engine serve` with its own smoke
(`npm run smoke:engine` in the engine's repository) before relying on `autoMerge`.
