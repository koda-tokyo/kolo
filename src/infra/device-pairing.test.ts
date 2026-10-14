import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  approveDevicePairing,
  getPairedDevice,
  requestDevicePairing,
  rotateDeviceToken,
  verifyDeviceToken,
} from "./device-pairing.js";

describe("device pairing tokens", () => {
  test("preserves existing token scopes when rotating without scopes", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "kolo-device-pairing-"));
    const request = await requestDevicePairing(
      {
        deviceId: "device-1",
        publicKey: "public-key-1",
        role: "operator",
        scopes: ["operator.admin"],
      },
      baseDir,
    );
    await approveDevicePairing(request.request.requestId, baseDir);

    await rotateDeviceToken({
      deviceId: "device-1",
      role: "operator",
      scopes: ["operator.read"],
      baseDir,
    });
    let paired = await getPairedDevice("device-1", baseDir);
    expect(paired?.tokens?.operator?.scopes).toEqual(["operator.read"]);
    expect(paired?.scopes).toEqual(["operator.read"]);

    await rotateDeviceToken({
      deviceId: "device-1",
      role: "operator",
      baseDir,
    });
    paired = await getPairedDevice("device-1", baseDir);
    expect(paired?.tokens?.operator?.scopes).toEqual(["operator.read"]);
  });

  test("verifies device tokens with a constant-time compare (any length)", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "kolo-device-pairing-"));
    const request = await requestDevicePairing(
      { deviceId: "device-2", publicKey: "public-key-2", role: "operator", scopes: [] },
      baseDir,
    );
    await approveDevicePairing(request.request.requestId, baseDir);
    const paired = await getPairedDevice("device-2", baseDir);
    const token = paired?.tokens?.operator?.token ?? "";
    expect(token).not.toBe("");
    const base = { deviceId: "device-2", role: "operator", scopes: [], baseDir };
    expect(await verifyDeviceToken({ ...base, token })).toEqual({ ok: true });
    for (const wrong of ["", "x", `${token}x`, token.slice(0, -1)]) {
      expect(await verifyDeviceToken({ ...base, token: wrong })).toEqual({
        ok: false,
        reason: "token-mismatch",
      });
    }
  });
});
