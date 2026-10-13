import { env, createExecutionContext, waitOnExecutionContext, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker, { hasRoleForRoute, requiresAccessAuthentication } from "../src/index";
import { onRequest as proxyApiRequest } from "../../../functions/api/[[path]]";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("Video API worker", () => {
  it("returns Not Found for an unknown route (unit style)", async () => {
    const request = new IncomingRequest("http://example.com/unknown");
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not Found" });
  });

  it("returns Not Found for an unknown route (integration style)", async () => {
    const response = await SELF.fetch("https://example.com/unknown");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not Found" });
  });

  it("requires an Access JWT for administrative API routes", async () => {
    const request = new IncomingRequest("http://example.com/api/videos");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, {
      ...env,
      ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
      ACCESS_AUD: "test-audience",
    }, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Access authentication required" });
  });

  it("keeps scheduled playback polling public", async () => {
    const request = new IncomingRequest("http://example.com/api/schedule");
    const playbackDb = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as D1Database;
    const response = await worker.fetch(
      request,
      { ...env, DB: playbackDb },
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(requiresAccessAuthentication("GET", "/api/schedule")).toBe(false);
  });

  it("keeps video streaming public while protecting the admin video list", async () => {
    const streamRequest = new IncomingRequest(
      "http://example.com/api/stream/videos/not-found/stream",
    );
    const playbackDb = {
      prepare: () => ({
        bind: () => ({
          first: async () => null,
        }),
      }),
    } as unknown as D1Database;
    const streamResponse = await worker.fetch(
      streamRequest,
      { ...env, DB: playbackDb },
      createExecutionContext(),
    );
    const listRequest = new IncomingRequest("http://example.com/api/videos");
    const listResponse = await worker.fetch(listRequest, {
      ...env,
      ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
      ACCESS_AUD: "test-audience",
    }, createExecutionContext());

    expect(streamResponse.status).toBe(404);
    expect(listResponse.status).toBe(401);
    expect(requiresAccessAuthentication("GET", "/api/stream/videos/not-found/stream")).toBe(false);
    expect(requiresAccessAuthentication("GET", "/api/videos/video-1/stream")).toBe(false);
    expect(requiresAccessAuthentication("GET", "/api/videos")).toBe(true);
  });

  it("fails closed when Access configuration is missing", async () => {
    const request = new IncomingRequest("http://example.com/api/videos", {
      headers: { "Cf-Access-Jwt-Assertion": "header.payload.signature" },
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Access authentication is not configured" });
  });

  it("allows the explicit loopback-only local development bypass", async () => {
    const localDb = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            id: "local-test-admin",
            email: "local-test-admin@example.invalid",
            role: "admin",
          }),
        }),
        all: async () => ({ results: [] }),
      }),
    } as unknown as D1Database;
    const localEnv = { ...env, DB: localDb, LOCAL_AUTH_BYPASS: "true" };

    const localResponse = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/videos"),
      localEnv,
      createExecutionContext(),
    );
    expect(localResponse.status).toBe(200);

    const remoteResponse = await worker.fetch(
      new IncomingRequest("https://example.com/api/videos"),
      localEnv,
      createExecutionContext(),
    );
    expect(remoteResponse.status).toBe(401);
  });

  it("rejects malformed Access JWTs", async () => {
    const request = new IncomingRequest("http://example.com/api/videos", {
      headers: { "Cf-Access-Jwt-Assertion": "not.a.valid-token" },
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, {
      ...env,
      ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
      ACCESS_AUD: "test-audience",
    }, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid Access authentication" });
  });

  it("applies separate roles to uploads and schedule changes", () => {
    expect(hasRoleForRoute({ role: "producer" }, "POST", "/api/videos")).toBe(true);
    expect(hasRoleForRoute({ role: "producer" }, "POST", "/api/schedules")).toBe(false);
    expect(hasRoleForRoute({ role: "operator" }, "POST", "/api/schedules")).toBe(true);
    expect(hasRoleForRoute({ role: "operator" }, "POST", "/api/videos")).toBe(false);
    expect(hasRoleForRoute({ role: "admin" }, "POST", "/api/videos")).toBe(true);
    expect(hasRoleForRoute({ role: "admin" }, "DELETE", "/api/schedules/123")).toBe(true);
    expect(hasRoleForRoute({ role: "producer" }, "DELETE", "/api/videos/video-1")).toBe(true);
    expect(hasRoleForRoute({ role: "operator" }, "DELETE", "/api/videos/video-1")).toBe(false);
    expect(requiresAccessAuthentication("DELETE", "/api/videos/video-1")).toBe(true);
    expect(requiresAccessAuthentication("GET", "/api/videos/video-1/stream")).toBe(false);
    expect(hasRoleForRoute({ role: "admin" }, "GET", "/api/users")).toBe(true);
    expect(hasRoleForRoute({ role: "producer" }, "GET", "/api/users")).toBe(false);
    expect(hasRoleForRoute({ role: "operator" }, "POST", "/api/users")).toBe(false);
    expect(requiresAccessAuthentication("PATCH", "/api/users/user-1")).toBe(true);
  });

  it("records the actor and target when a schedule is created", async () => {
    const auditRows: Array<{ sql: string; values: unknown[] }> = [];
    const admin = {
      id: "local-test-admin",
      email: "local-test-admin@example.invalid",
      role: "admin",
    };
    const auditDb = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({
          first: async () => sql.includes("FROM users")
            ? admin
            : sql.includes("FROM videos")
              ? { id: "video-1" }
              : null,
          run: async () => {
            if (sql.includes("INSERT INTO audit_logs")) {
              auditRows.push({ sql, values });
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    } as unknown as D1Database;
    const request = new IncomingRequest("http://127.0.0.1:8787/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId: "video-1", startsAt: "2030-01-01T00:00:00Z" }),
    });

    const response = await worker.fetch(request, {
      ...env,
      DB: auditDb,
      LOCAL_AUTH_BYPASS: "true",
    }, createExecutionContext());

    expect(response.status).toBe(201);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].values[1]).toBe(admin.id);
    expect(auditRows[0].values[2]).toBe("schedule.created");
    expect(auditRows[0].values[3]).toBe("schedule");
    expect(JSON.parse(String(auditRows[0].values[5]))).toEqual({
      videoId: "video-1",
      startsAt: "2030-01-01T00:00:00.000Z",
    });
  });

  it("deletes an unused video and its R2 object for an authorized owner", async () => {
    const admin = {
      id: "local-test-admin",
      email: "local-test-admin@example.invalid",
      role: "admin",
    };
    const deletedObjects: string[] = [];
    const auditActions: string[] = [];
    const deleteDb = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({
          first: async () => sql.includes("FROM users")
            ? admin
            : sql.includes("FROM videos")
              ? { r2Key: "videos/video-1", uploadedBy: admin.id }
              : null,
          run: async () => {
            if (sql.includes("INSERT INTO audit_logs")) {
              auditActions.push(String(values[2]));
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    } as unknown as D1Database;
    const bucket = {
      delete: async (key: string) => { deletedObjects.push(key); },
    } as unknown as R2Bucket;
    const request = new IncomingRequest("http://127.0.0.1:8787/api/videos/video-1", {
      method: "DELETE",
    });

    const response = await worker.fetch(request, {
      ...env,
      DB: deleteDb,
      VIDEO_BUCKET: bucket,
      LOCAL_AUTH_BYPASS: "true",
    }, createExecutionContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      deletedId: "video-1",
      storageCleanupPending: false,
    });
    expect(deletedObjects).toEqual(["videos/video-1"]);
    expect(auditActions).toEqual(["video.deleted"]);
  });

  it("returns unused status and delete permission without exposing uploader IDs", async () => {
    const admin = {
      id: "local-test-admin",
      email: "local-test-admin@example.invalid",
      role: "admin",
    };
    const listDb = {
      prepare: (sql: string) => ({
        all: async () => ({
          results: [
            { id: "unused", title: "Unused", uploadedBy: admin.id, isUnused: 1 },
            { id: "scheduled", title: "Scheduled", uploadedBy: "another-user", isUnused: 0 },
          ],
        }),
        bind: () => ({
          first: async () => sql.includes("FROM users") ? admin : null,
        }),
      }),
    } as unknown as D1Database;
    const response = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/videos"),
      { ...env, DB: listDb, LOCAL_AUTH_BYPASS: "true" },
      createExecutionContext(),
    );
    const body = await response.json() as { videos: Array<Record<string, unknown>>; canManageUsers: boolean };

    expect(response.status).toBe(200);
    expect(body.canManageUsers).toBe(true);
    expect(body.videos).toEqual([
      { id: "unused", title: "Unused", canDelete: true, isUnused: true },
      { id: "scheduled", title: "Scheduled", canDelete: true, isUnused: false },
    ]);
  });

  it("creates a role record and writes an audit event for an admin", async () => {
    const admin = {
      id: "local-test-admin",
      email: "local-test-admin@example.invalid",
      role: "admin",
    };
    const insertedUsers: unknown[][] = [];
    const auditActions: string[] = [];
    const userDb = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({
          first: async () => sql.includes("WHERE id = ? AND role = 'admin'") ? admin : null,
          run: async () => {
            if (sql.includes("INSERT INTO users")) insertedUsers.push(values);
            if (sql.includes("INSERT INTO audit_logs")) auditActions.push(String(values[2]));
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    } as unknown as D1Database;
    const request = new IncomingRequest("http://127.0.0.1:8787/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "producer@example.com", role: "producer" }),
    });

    const response = await worker.fetch(request, {
      ...env,
      DB: userDb,
      LOCAL_AUTH_BYPASS: "true",
    }, createExecutionContext());

    expect(response.status).toBe(201);
    expect(insertedUsers).toHaveLength(1);
    expect(insertedUsers[0][1]).toBe("producer@example.com");
    expect(insertedUsers[0][2]).toBe("producer");
    expect(auditActions).toEqual(["user.created"]);
  });

  it("forwards the original request and Access/Range headers through the Pages proxy", async () => {
    const request = new Request("https://cp-dashboard-d17.pages.dev/api/stream/videos/video-1/stream", {
      headers: {
        "Cf-Access-Jwt-Assertion": "signed-access-token",
        Range: "bytes=0-1023",
      },
    });
    let forwardedRequest: Request | undefined;
    const response = await proxyApiRequest({
      request,
      env: {
        VIDEO_API: {
          fetch: async (forwarded) => {
            forwardedRequest = forwarded;
            return new Response("forwarded", { status: 206 });
          },
        },
      },
    });

    expect(response.status).toBe(206);
    expect(forwardedRequest).toBe(request);
    expect(forwardedRequest?.headers.get("Cf-Access-Jwt-Assertion")).toBe("signed-access-token");
    expect(forwardedRequest?.headers.get("Range")).toBe("bytes=0-1023");
  });

  it("returns a clear error when the Pages service binding is missing", async () => {
    const response = await proxyApiRequest({
      request: new Request("https://cp-dashboard-d17.pages.dev/api/videos"),
      env: {} as { VIDEO_API: { fetch(request: Request): Promise<Response> } },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Video API service is not connected" });
  });
});
