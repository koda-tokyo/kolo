export const SECRET_REF_KEY = "$secret";

export type SecretRef = { [SECRET_REF_KEY]: string };

// Dotted names: channel.line.channelAccessToken, provider.openai.apiKey, gateway.token, env.FOO_KEY.
const SECRET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/;
const MAX_SECRET_NAME = 200;

export function isValidSecretName(name: string): boolean {
  return name.length <= MAX_SECRET_NAME && SECRET_NAME_PATTERN.test(name);
}

export function assertValidSecretName(name: string): string {
  const trimmed = name.trim();
  if (!isValidSecretName(trimmed)) {
    throw new Error(
      `invalid secret name "${trimmed.slice(0, 80)}" (dotted segments of letters, digits, _ or -; e.g. provider.openai.apiKey)`,
    );
  }
  return trimmed;
}

/** `{"$secret": "name"}` with no other keys. */
export function isSecretRef(value: unknown): value is SecretRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === 1 &&
    keys[0] === SECRET_REF_KEY &&
    typeof (value as Record<string, unknown>)[SECRET_REF_KEY] === "string"
  );
}

export function secretRef(name: string): SecretRef {
  return { [SECRET_REF_KEY]: name };
}
