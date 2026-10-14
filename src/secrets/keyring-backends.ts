// OS keyring backends, driven through the platform CLIs (no native npm dependency):
// Linux Secret Service via `secret-tool`, macOS Keychain via `security`, Windows DPAPI via
// PowerShell `[System.Security.Cryptography.ProtectedData]`.
// Secret values are passed on stdin or in the child env, never argv.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { defaultExecSync, type ExecSync } from "./exec.js";
import { assertValidSecretName } from "./names.js";
import { type SecretBackendId, type SecretStore, SecretStoreError } from "./types.js";

const VALUE_CACHE_TTL_MS = 60_000;

export type KeyringStoreOptions = {
  /** `<KOLO_HOME>/secrets` — holds the names index (names only, no values). */
  dir: string;
  /** Namespaces entries per state root so sibling gateways never collide. */
  home: string;
  exec?: ExecSync;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
};

function homeTag(home: string): string {
  return crypto.createHash("sha256").update(path.resolve(home)).digest("hex").slice(0, 12);
}

function failure(backend: string, action: string, res: { stderr: string; timedOut: boolean }) {
  const detail = res.timedOut ? "timed out" : res.stderr.trim().split("\n")[0]?.slice(0, 200);
  return new SecretStoreError(`${backend}: ${action} failed${detail ? ` (${detail})` : ""}`);
}

abstract class KeyringStoreBase implements SecretStore {
  abstract readonly backend: SecretBackendId;
  abstract readonly location: string;
  protected readonly dir: string;
  protected readonly tag: string;
  protected readonly exec: ExecSync;
  protected readonly env: NodeJS.ProcessEnv;
  private readonly now: () => number;
  private readonly values = new Map<string, { value: string | undefined; at: number }>();

  constructor(opts: KeyringStoreOptions) {
    this.dir = opts.dir;
    this.tag = homeTag(opts.home);
    this.exec = opts.exec ?? defaultExecSync;
    this.env = opts.env ?? process.env;
    this.now = opts.now ?? Date.now;
  }

  protected abstract read(name: string): string | undefined;
  protected abstract write(name: string, value: string): void;
  protected abstract remove(name: string): boolean;

  private get indexPath() {
    return path.join(this.dir, `index.${this.backend}.json`);
  }

  protected readIndex(): string[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexPath, "utf8")) as { names?: unknown };
      return Array.isArray(parsed.names)
        ? parsed.names.filter((n): n is string => typeof n === "string")
        : [];
    } catch {
      return [];
    }
  }

  protected writeIndex(names: string[]) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const unique = Array.from(new Set(names)).toSorted();
    fs.writeFileSync(this.indexPath, `${JSON.stringify({ names: unique })}\n`, { mode: 0o600 });
  }

  get(name: string): string | undefined {
    const cached = this.values.get(name);
    if (cached && this.now() - cached.at < VALUE_CACHE_TTL_MS) {
      return cached.value;
    }
    const value = this.read(name);
    this.values.set(name, { value, at: this.now() });
    return value;
  }

  set(name: string, value: string): void {
    const valid = assertValidSecretName(name);
    if (typeof value !== "string" || value.length === 0) {
      throw new SecretStoreError("secret value must be a non-empty string");
    }
    this.write(valid, value);
    this.values.set(valid, { value, at: this.now() });
    this.writeIndex([...this.readIndex(), valid]);
  }

  delete(name: string): boolean {
    const removed = this.remove(name);
    this.values.delete(name);
    const names = this.readIndex();
    if (names.includes(name)) {
      this.writeIndex(names.filter((n) => n !== name));
      return true;
    }
    return removed;
  }

  list(): string[] {
    return this.readIndex().toSorted();
  }
}

/** Linux Secret Service (GNOME Keyring, KWallet bridge, KeePassXC) via `secret-tool`. */
export class SecretServiceStore extends KeyringStoreBase {
  readonly backend = "secret-service" as const;
  get location() {
    return `secret-service (service=kolo home=${this.tag})`;
  }

  private attrs(name: string) {
    return ["service", "kolo", "home", this.tag, "name", name];
  }

  protected read(name: string): string | undefined {
    const res = this.exec("secret-tool", ["lookup", ...this.attrs(name)], { env: this.env });
    if (res.status === 0) {
      return res.stdout.length > 0 ? res.stdout.replace(/\n$/, "") : undefined;
    }
    if (res.status === 1 && !res.timedOut) {
      return undefined;
    }
    throw failure("secret-service", "lookup", res);
  }

  protected write(name: string, value: string): void {
    const res = this.exec("secret-tool", ["store", `--label=KoLo ${name}`, ...this.attrs(name)], {
      input: value,
      env: this.env,
    });
    if (res.status !== 0) {
      throw failure("secret-service", "store", res);
    }
  }

  protected remove(name: string): boolean {
    const res = this.exec("secret-tool", ["clear", ...this.attrs(name)], { env: this.env });
    return res.status === 0;
  }
}

/** macOS Keychain via `security`. Writes go through `security -i` on stdin (value hex-encoded). */
export class KeychainStore extends KeyringStoreBase {
  readonly backend = "keychain" as const;
  get location() {
    return `keychain (service=kolo.${this.tag})`;
  }

  private get service() {
    return `kolo.${this.tag}`;
  }

  protected read(name: string): string | undefined {
    const res = this.exec(
      "security",
      ["find-generic-password", "-s", this.service, "-a", name, "-w"],
      { env: this.env },
    );
    if (res.status === 0) {
      return res.stdout.replace(/\n$/, "");
    }
    // 44 = errSecItemNotFound
    if (res.status === 44) {
      return undefined;
    }
    throw failure("keychain", "find-generic-password", res);
  }

  protected write(name: string, value: string): void {
    const hex = Buffer.from(value, "utf8").toString("hex");
    // Names are validated (no whitespace or quotes), so the interactive command line is unambiguous.
    const res = this.exec("security", ["-i"], {
      input: `add-generic-password -U -s ${this.service} -a ${name} -X ${hex}\n`,
      env: this.env,
    });
    if (res.status !== 0 || /error|fail/i.test(res.stderr)) {
      throw failure("keychain", "add-generic-password", res);
    }
  }

  protected remove(name: string): boolean {
    const res = this.exec("security", ["delete-generic-password", "-s", this.service, "-a", name], {
      env: this.env,
    });
    return res.status === 0;
  }
}

const DPAPI_PROTECT = [
  "Add-Type -AssemblyName System.Security",
  "$b=[Convert]::FromBase64String($env:KOLO_DPAPI_IN)",
  "$e=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Out.Write([Convert]::ToBase64String($e))",
].join("; ");

const DPAPI_UNPROTECT = [
  "Add-Type -AssemblyName System.Security",
  "$b=[Convert]::FromBase64String($env:KOLO_DPAPI_IN)",
  "$d=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Out.Write([Convert]::ToBase64String($d))",
].join("; ");

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/**
 * Windows DPAPI (CurrentUser scope). DPAPI encrypts but does not store, so each protected blob
 * lives in `<KOLO_HOME>/secrets/dpapi/<name>.bin`; only this Windows user can unprotect it.
 * Input travels in the child's environment (KOLO_DPAPI_IN), never on the command line.
 */
export class DpapiStore extends KeyringStoreBase {
  readonly backend = "dpapi" as const;
  get location() {
    return `dpapi (${this.blobDir})`;
  }

  private get blobDir() {
    return path.join(this.dir, "dpapi");
  }

  private blobPath(name: string) {
    return path.join(this.blobDir, `${name}.bin`);
  }

  private run(script: string, inputB64: string, action: string): string {
    const res = this.exec(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShell(script)],
      { env: { ...this.env, KOLO_DPAPI_IN: inputB64 } },
    );
    if (res.status !== 0) {
      throw failure("dpapi", action, res);
    }
    return res.stdout.trim();
  }

  protected read(name: string): string | undefined {
    let blob: string;
    try {
      blob = fs.readFileSync(this.blobPath(name), "utf8").trim();
    } catch {
      return undefined;
    }
    const out = this.run(DPAPI_UNPROTECT, blob, "unprotect");
    return Buffer.from(out, "base64").toString("utf8");
  }

  protected write(name: string, value: string): void {
    const out = this.run(DPAPI_PROTECT, Buffer.from(value, "utf8").toString("base64"), "protect");
    fs.mkdirSync(this.blobDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.blobPath(name), `${out}\n`, { mode: 0o600 });
  }

  protected remove(name: string): boolean {
    try {
      fs.rmSync(this.blobPath(name));
      return true;
    } catch {
      return false;
    }
  }
}
