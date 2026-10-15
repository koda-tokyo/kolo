import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addOwner,
  loadOrCreateOwnerKey,
  readSignature,
  signPolicyFile,
  verifyPolicyAttestation,
} from "./attestation.js";
import { acceptPolicy, loadPolicyFile } from "./load.js";
import { resolvePolicyLocations } from "./paths.js";
import { STARTER_POLICY_YAML } from "./starter.js";

let home: string;
let loc: ReturnType<typeof resolvePolicyLocations>;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-policy-att-"));
  loc = resolvePolicyLocations({ KOLO_HOME: home });
  fs.mkdirSync(loc.dir, { recursive: true });
  fs.writeFileSync(loc.policyPath, STARTER_POLICY_YAML);
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("policy attestation", () => {
  it("signs, verifies, and refuses a changed document", () => {
    const key = loadOrCreateOwnerKey(loc.ownerKeyPath);
    if (process.platform !== "win32") {
      // NTFS has no POSIX mode bits; the key is still written through the 0600 path there.
      expect(fs.statSync(loc.ownerKeyPath).mode & 0o777).toBe(0o600);
    }
    expect(addOwner(loc.ownersPath, { publicKey: key.publicKey, label: "ci" })).toBe(true);
    expect(addOwner(loc.ownersPath, { publicKey: key.publicKey })).toBe(false);

    const sig = signPolicyFile({
      policyPath: loc.policyPath,
      signaturePath: loc.signaturePath,
      key,
    });
    expect(readSignature(loc.signaturePath)?.keyId).toBe(sig.keyId);
    const bytes = fs.readFileSync(loc.policyPath);
    expect(
      verifyPolicyAttestation({
        policyBytes: bytes,
        signaturePath: loc.signaturePath,
        ownersPath: loc.ownersPath,
      }).state,
    ).toBe("signed");

    fs.appendFileSync(loc.policyPath, "\n# edited after signing\n");
    const after = verifyPolicyAttestation({
      policyBytes: fs.readFileSync(loc.policyPath),
      signaturePath: loc.signaturePath,
      ownersPath: loc.ownersPath,
    });
    expect(after.state).toBe("invalid");
    expect(after.reason).toMatch(/changed since/);
  });

  it("does not trust a signer that is not a pinned owner", () => {
    const stranger = loadOrCreateOwnerKey(path.join(home, "stranger.json"));
    signPolicyFile({ policyPath: loc.policyPath, signaturePath: loc.signaturePath, key: stranger });
    const bytes = fs.readFileSync(loc.policyPath);
    expect(
      verifyPolicyAttestation({
        policyBytes: bytes,
        signaturePath: loc.signaturePath,
        ownersPath: loc.ownersPath,
      }).state,
    ).toBe("no-owners");
    const owner = loadOrCreateOwnerKey(loc.ownerKeyPath);
    addOwner(loc.ownersPath, { publicKey: owner.publicKey });
    expect(
      verifyPolicyAttestation({
        policyBytes: bytes,
        signaturePath: loc.signaturePath,
        ownersPath: loc.ownersPath,
      }).state,
    ).toBe("untrusted");
  });

  it("refuses a forged signature file", () => {
    const key = loadOrCreateOwnerKey(loc.ownerKeyPath);
    addOwner(loc.ownersPath, { publicKey: key.publicKey });
    const sig = signPolicyFile({
      policyPath: loc.policyPath,
      signaturePath: loc.signaturePath,
      key,
    });
    // Flip a character in the middle of the base64 signature: trailing characters only carry
    // padding bits and can decode to the same bytes, so a forge there is flaky by construction.
    const mid = Math.floor(sig.signature.length / 2);
    const flipped = sig.signature[mid] === "A" ? "B" : "A";
    const forged = `${sig.signature.slice(0, mid)}${flipped}${sig.signature.slice(mid + 1)}`;
    expect(forged).not.toBe(sig.signature);
    fs.writeFileSync(loc.signaturePath, JSON.stringify({ ...sig, signature: forged }));
    const result = verifyPolicyAttestation({
      policyBytes: fs.readFileSync(loc.policyPath),
      signaturePath: loc.signaturePath,
      ownersPath: loc.ownersPath,
    });
    expect(result.state).toBe("invalid");
    expect(result.reason).toMatch(/does not verify/);
  });
});

describe("policy acceptance by mode", () => {
  it("enforce refuses unsigned, audit warns, off never loads", () => {
    const loaded = loadPolicyFile(loc);
    expect(loaded.state).toBe("loaded");
    const enforce = acceptPolicy(loaded, "enforce");
    expect(enforce.accepted).toBe(false);
    if (!enforce.accepted) {
      expect(enforce.reason).toMatch(/unsigned/);
      expect(enforce.reason).toMatch(/kurahi policy sign/);
    }
    const audit = acceptPolicy(loaded, "audit");
    expect(audit.accepted).toBe(true);
    expect(audit.warnings.join("\n")).toMatch(/policy mode is audit/);
    expect(acceptPolicy(loaded, "off").accepted).toBe(false);
  });

  it("enforce accepts a signed policy, and an unsigned one that opts out of attestation", () => {
    const key = loadOrCreateOwnerKey(loc.ownerKeyPath);
    addOwner(loc.ownersPath, { publicKey: key.publicKey });
    signPolicyFile({ policyPath: loc.policyPath, signaturePath: loc.signaturePath, key });
    expect(acceptPolicy(loadPolicyFile(loc), "enforce").accepted).toBe(true);

    fs.rmSync(loc.signaturePath);
    fs.writeFileSync(loc.policyPath, "version: 1\nattestation:\n  required: false\n");
    const optOut = acceptPolicy(loadPolicyFile(loc), "enforce");
    expect(optOut.accepted).toBe(true);
    expect(optOut.warnings.join("\n")).toMatch(/attestation.required is false/);
  });

  it("reports absent and invalid files", () => {
    fs.rmSync(loc.policyPath);
    expect(loadPolicyFile(loc).state).toBe("absent");
    fs.writeFileSync(loc.policyPath, "version: 7\n");
    const invalid = loadPolicyFile(loc);
    expect(invalid.state).toBe("invalid");
    const acc = acceptPolicy(invalid, "audit");
    expect(acc.accepted).toBe(false);
  });
});
