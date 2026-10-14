import { describe, expect, it } from "vitest";
import { GATEWAY_ROUTES } from "./http-routes.js";
import {
  httpRouteMinScope,
  legacyOperatorScopesFor,
  minScope,
  PAIR_SCOPES,
  parseInvitableScope,
  parsePairScope,
  routeMinScope,
  scopeSatisfies,
  wsMethodMinScope,
} from "./scopes.js";
import { BASE_GATEWAY_METHODS } from "./server-methods-list.js";

describe("scope model (M3a)", () => {
  it("orders owner > admin > attach > observe", () => {
    expect(PAIR_SCOPES).toEqual(["observe", "attach", "admin", "owner"]);
    for (const [i, granted] of PAIR_SCOPES.entries()) {
      for (const [j, required] of PAIR_SCOPES.entries()) {
        expect(scopeSatisfies(granted, required)).toBe(i >= j);
      }
    }
    expect(minScope("admin", "attach")).toBe("attach");
    expect(minScope("observe", "owner")).toBe("observe");
  });

  it("parses scopes strictly and never lets an invitation grant owner", () => {
    expect(parsePairScope(" Admin ")).toBe("admin");
    expect(parsePairScope("root")).toBeNull();
    expect(parsePairScope(42)).toBeNull();
    expect(parseInvitableScope("owner")).toBeNull();
    expect(parseInvitableScope("attach")).toBe("attach");
  });

  it("defaults every HTTP route to admin unless the table says otherwise", () => {
    expect(httpRouteMinScope("someFutureOperation")).toBe("admin");
    expect(httpRouteMinScope("getMetrics")).toBe("observe");
    expect(httpRouteMinScope("invokeTool")).toBe("attach");
    expect(httpRouteMinScope("createPairInvitation")).toBe("admin");
    expect(routeMinScope({ operationId: "getMetrics", minScope: "admin" })).toBe("admin");
  });

  it("gives every registry route that accepts a pair credential a resolvable minimum scope", () => {
    const pairRoutes = GATEWAY_ROUTES.filter((r) =>
      (Array.isArray(r.auth) ? r.auth : [r.auth]).includes("pair-credential"),
    );
    expect(pairRoutes.length).toBeGreaterThanOrEqual(15);
    for (const route of pairRoutes) {
      expect(PAIR_SCOPES).toContain(routeMinScope(route));
    }
    // Public pairing routes must not carry a scope (they are reached before any credential).
    for (const id of ["createPairNonce", "redeemPairInvitation", "refreshPairCredential"]) {
      const route = GATEWAY_ROUTES.find((r) => r.operationId === id);
      expect(route?.auth).toBe("none");
    }
    // Minting invitations is never below admin.
    expect(
      routeMinScope(GATEWAY_ROUTES.find((r) => r.operationId === "createPairInvitation")!),
    ).toBe("admin");
  });

  it("defaults every WS method to admin unless listed as observe/attach", () => {
    expect(wsMethodMinScope("config.set")).toBe("admin");
    expect(wsMethodMinScope("some.future.method")).toBe("admin");
    expect(wsMethodMinScope("health")).toBe("observe");
    expect(wsMethodMinScope("chat.send")).toBe("attach");
    expect(wsMethodMinScope("pair.invite")).toBe("admin");
    expect(wsMethodMinScope("pair.redeem")).toBe("observe");
    // Every listed method resolves; mutating config/cron/sessions stays admin.
    for (const method of BASE_GATEWAY_METHODS) {
      expect(PAIR_SCOPES).toContain(wsMethodMinScope(method));
    }
    for (const method of [
      "config.apply",
      "cron.add",
      "sessions.delete",
      "update.run",
      "wizard.start",
    ]) {
      expect(wsMethodMinScope(method)).toBe("admin");
    }
  });

  it("maps pair scopes onto the legacy operator scopes without over-granting", () => {
    expect(legacyOperatorScopesFor("observe")).toEqual(["operator.read"]);
    expect(legacyOperatorScopesFor("attach")).not.toContain("operator.admin");
    expect(legacyOperatorScopesFor("attach")).toContain("operator.write");
    expect(legacyOperatorScopesFor("admin")).toContain("operator.admin");
    expect(legacyOperatorScopesFor("owner")).toContain("operator.pairing");
  });
});
