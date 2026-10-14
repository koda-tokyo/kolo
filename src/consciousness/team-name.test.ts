import { describe, expect, it } from "vitest";
import { DEFAULT_TEAM_NAME, resolveTeamName } from "./team-name.js";

describe("resolveTeamName", () => {
  it("uses KOLO_TEAM_NAME when it is a safe name", () => {
    expect(resolveTeamName({ KOLO_TEAM_NAME: "ops-team" })).toBe("ops-team");
  });
  it("falls back to the default when unset, blank or unsafe", () => {
    expect(resolveTeamName({})).toBe(DEFAULT_TEAM_NAME);
    expect(resolveTeamName({ KOLO_TEAM_NAME: "  " })).toBe(DEFAULT_TEAM_NAME);
    expect(resolveTeamName({ KOLO_TEAM_NAME: "../escape" })).toBe(DEFAULT_TEAM_NAME);
  });
});
