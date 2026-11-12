import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { expect, it } from "vitest";
import worker from "../src/index";

it("publishes a validated theme only after review and can return devices to local settings", async () => {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE shared_settings (id INTEGER PRIMARY KEY, settings_json TEXT, apply_json TEXT, updated_at TEXT)"),
    env.DB.prepare("INSERT INTO shared_settings VALUES (1, '{\"isBannerVisible\":true}', '{}', datetime('now'))"),
    env.DB.prepare("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, role TEXT)"),
    env.DB.prepare("INSERT INTO users VALUES ('local-test-admin', 'admin@example.invalid', 'admin'), ('reviewer', 'mentor@example.invalid', 'mentor')"),
    env.DB.prepare("CREATE TABLE change_requests (id TEXT PRIMARY KEY, requester_id TEXT, kind TEXT, summary TEXT, payload_json TEXT, status TEXT DEFAULT 'pending', reviewed_by TEXT, created_at TEXT DEFAULT (datetime('now')), reviewed_at TEXT)"),
    env.DB.prepare("CREATE TABLE audit_logs (id TEXT, actor_id TEXT, action TEXT, target_type TEXT, target_id TEXT, details TEXT)"),
  ]);
  const request = async (method: string, path: string, role?: "admin" | "mentor", body?: unknown) => {
    // Keep real D1 storage, but give the local mentor a distinct identity.
    const db = new Proxy(env.DB, {
      get(target, key) {
        if (key === "prepare") {
          return (sql: string) => sql.includes("WHERE id = ? AND role = 'mentor'")
            ? { bind: () => target.prepare("SELECT id, email, role FROM users WHERE id = 'reviewer'") }
            : target.prepare(sql);
        }
        return Reflect.get(target, key);
      },
    });
    const ctx = createExecutionContext();
    const result = await worker.fetch(new Request(`http://127.0.0.1:8787${path}`, {
      method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    }), {
      ...env, DB: db, LOCAL_AUTH_BYPASS: role ? "true" : "false",
      LOCAL_AUTH_BYPASS_ROLE: role,
      ACCESS_TEAM_DOMAIN: role ? "" : "https://example.cloudflareaccess.com",
      ACCESS_AUD: role ? "" : "example-audience",
    }, ctx);
    await waitOnExecutionContext(ctx);
    return result;
  };
  const read = async () => (await (await request("GET", "/api/settings")).json() as {
    settings: { dashboardTheme?: string | null; isBannerVisible: boolean };
  }).settings;
  const patch = (theme: unknown) => ({ settings: { dashboardTheme: theme }, adminEdit: true });

  expect((await request("PUT", "/api/settings", undefined, patch("blue-flame"))).status).toBe(401);
  expect((await request("PUT", "/api/settings", "admin", patch("not-a-theme"))).status).toBe(400);
  expect((await request("PUT", "/api/settings", "admin", patch("system"))).status).toBe(400);
  for (const theme of ["blue-flame", null]) {
    const response = await request("PUT", "/api/settings", "admin", patch(theme));
    expect(response.status, await response.clone().text()).toBe(202);
    const pending = await env.DB.prepare("SELECT id, summary FROM change_requests WHERE status = 'pending'").first<{ id: string; summary: string }>();
    expect(pending?.summary).toContain("全端末のテーマ");
    expect((await read()).dashboardTheme).toBe(theme === null ? "blue-flame" : undefined);
    const approve = `/api/change-requests/${pending!.id}/approve`;
    expect((await request("POST", approve, "admin")).status).toBe(403);
    const reviewed = await request("POST", approve, "mentor");
    expect(reviewed.status, await reviewed.clone().text()).toBe(200);
    expect(await read()).toEqual({ isBannerVisible: true, dashboardTheme: theme });
  }
});
