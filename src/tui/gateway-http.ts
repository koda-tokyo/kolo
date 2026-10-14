/**
 * Small HTTP client for the gateway's REST routes, used by the TUI for operations that are not
 * WebSocket methods (session snapshots, M10). The base URL is derived from the WebSocket URL and
 * the same gateway token authenticates. A password-only connection cannot use these routes.
 */

export type GatewayHttpError = { status: number; error: string };

export function httpBaseFromWsUrl(wsUrl: string): string {
  const url = new URL(wsUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export type GatewayHttp = {
  request: <T>(
    method: "GET" | "POST",
    apiPath: string,
    body?: unknown,
  ) => Promise<{ ok: true; body: T } | { ok: false; status: number; error: string }>;
};

export function createGatewayHttp(
  connection: { url: string; token?: string },
  fetchImpl: typeof fetch = fetch,
): GatewayHttp {
  const base = httpBaseFromWsUrl(connection.url);
  return {
    request: async (method, apiPath, body) => {
      if (!connection.token) {
        return {
          ok: false,
          status: 0,
          error: "this needs the gateway token (password-only connections cannot use it)",
        };
      }
      let response: Response;
      try {
        response = await fetchImpl(`${base}${apiPath}`, {
          method,
          headers: {
            authorization: `Bearer ${connection.token}`,
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        return { ok: false, status: 0, error: `gateway unreachable (${String(err)})` };
      }
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      const record = (parsed ?? {}) as { ok?: boolean; error?: unknown };
      if (!response.ok || record.ok === false) {
        const error =
          typeof record.error === "string"
            ? record.error
            : record.error && typeof record.error === "object" && "message" in record.error
              ? String((record.error as { message: unknown }).message)
              : `HTTP ${response.status}`;
        return { ok: false, status: response.status, error };
      }
      return { ok: true, body: parsed as never };
    },
  };
}
