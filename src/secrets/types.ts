// Encrypted secrets store (KoLo 2.0, M2a — CSO Gap A).
// Secrets live outside kolo.json; config references them as {"$secret": "<name>"}.

export type SecretBackendId = "file" | "secret-service" | "keychain" | "dpapi";

export interface SecretStore {
  readonly backend: SecretBackendId;
  /** Human-readable location (path or keyring service) — never a value. */
  readonly location: string;
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  delete(name: string): boolean;
  /** Secret names only, sorted. Never values. */
  list(): string[];
}

export class SecretStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretStoreError";
  }
}

/** Raised when the encrypted file cannot be decrypted (wrong key or tampered file). */
export class SecretStoreDecryptError extends SecretStoreError {
  constructor(location: string) {
    super(
      `cannot decrypt secrets store at ${location}: wrong key (KOLO_SECRETS_KEY / secrets/.key) or the file was modified`,
    );
    this.name = "SecretStoreDecryptError";
  }
}

export class MissingSecretError extends Error {
  constructor(
    public readonly secretName: string,
    public readonly configPath: string,
  ) {
    super(
      `Missing secret "${secretName}" referenced at config path: ${configPath || "<root>"} (run: kurahi secrets set ${secretName})`,
    );
    this.name = "MissingSecretError";
  }
}
