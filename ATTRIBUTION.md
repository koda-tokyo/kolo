# Attribution

Kurahi includes and builds on open-source work. This file lists the upstream projects whose licences require that their copyright notice be retained, together with the design patterns adopted from other projects. The full dependency inventory is in `pnpm-lock.yaml`; each package carries its own licence file under `node_modules`.

## Upstream fork

Parts of the gateway, CLI, channel integrations and documentation derive from the OpenClaw project (earlier published as Clawdbot and Moltbot), released under the MIT License.

```
MIT License

Copyright (c) 2025 Peter Steinberger

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Kurahi is not endorsed by or affiliated with the upstream project or its maintainers. KODA's own contributions and the work as a whole are licensed as described in `LICENSING.md`.

## Adapted design patterns (no code copied)

Parts of the terminal UI (`src/tui`) were written after studying two open-source terminals. No source code from either project was copied; they are listed for attribution of the ideas.

- openai/codex (Apache License 2.0), crate `codex-rs/tui`: the "history cell" model (each assistant message becomes its own committed cell when a tool starts or a new message begins, with a separate mutable tail) and the per-thread buffered event and replay discipline in which the completed item, not the stream, is the authoritative text. https://github.com/openai/codex/blob/main/LICENSE
- sst/opencode (MIT License), `packages/tui` and `packages/opencode/src/server`: the resync discipline (after a stream ends or a connection comes back, the client re-reads the server's record and redraws from it). https://github.com/sst/opencode

## Third-party components

Runtime dependencies are listed in `package.json` and `extensions/*/package.json`. Their licences (MIT, Apache-2.0, BSD and ISC in the main) apply only to the components they cover and are reproduced in each package. Nothing in this repository claims ownership of a third-party component.
