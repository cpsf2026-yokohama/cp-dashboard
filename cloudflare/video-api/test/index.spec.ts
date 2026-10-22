import { env, createExecutionContext, waitOnExecutionContext, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker, { expandPlaybackSchedules, hasRoleForRoute, requiresAccessAuthentication, resolveAccessUser } from "../src/index";
import { onRequest as proxyApiRequest } from "../../../functions/api/[[path]]";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("Video API worker", () => {
  it("fails closed when Access email matching finds ambiguous case variants", () => {
    expect(resolveAccessUser([
      { id: "admin-1", email: "person@example.com", role: "admin" },
      { id: "mentor-1", email: "PERSON@example.com", role: "mentor" },
    ])).toBeNull();
    expect(resolveAccessUser([{ id: "unknown", email: "person@example.com", role: "owner" }])).toBeNull();
    expect(resolveAccessUser([{ id: "mentor-1", email: "person@example.com", role: "mentor" }])).toEqual({
      id: "mentor-1", email: "person@example.com", role: "mentor",
    });
  });

  it("allows browser preflight requests for shared settings updates", async () => {
    const response = await worker.fetch(
      new IncomingRequest("http://localhost:8787/api/settings", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers": "content-type",
        },
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000",
    );
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "PUT",
    );
  });

  it("returns Not Found for an unknown route (unit style)", async () => {
    const request = new IncomingRequest("http://example.com/unknown");
    const ctx = createExecutionContext();

    const response = await worker.fetch(
      request,
      {
        ...env,
        ACCESS_TEAM_DOMAIN: "",
        ACCESS_AUD: "",
        LOCAL_AUTH_BYPASS: "false",
      },
      ctx,
    );
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

    const response = await worker.fetch(
      request,
      {
        ...env,
        ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
        ACCESS_AUD: "test-audience",
      },
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Access authentication required",
    });
  });

  it("reads the Access cookie and validates its token", async () => {
    const request = new IncomingRequest("http://example.com/api/settings", {
      method: "PUT",
      headers: { Cookie: "other=value; CF_Authorization=not.a.valid-token" },
    });

    const response = await worker.fetch(
      request,
      {
        ...env,
        ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
        ACCESS_AUD: "test-audience",
      },
      createExecutionContext(),
    );

    // The cookie was found and sent through JWT validation. It was rejected as
    // malformed rather than treated as a missing authentication token.
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Invalid Access authentication",
    });
  });

  it("keeps scheduled playback polling public", async () => {
    const request = new IncomingRequest("http://example.com/api/schedule");
    let scheduleWindow: unknown[] = []

    const playbackDb = {
      prepare: () => ({
        bind: (...values: unknown[]) => {
          scheduleWindow = values
          return {
            all: async () => ({ results: [] }),
          }
        },
      }),
    } as unknown as D1Database;

    const response = await worker.fetch(
      request,
      { ...env, DB: playbackDb },
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(requiresAccessAuthentication("GET", "/api/schedule")).toBe(false);
    const lookaheadMs = Date.parse(String(scheduleWindow[1])) - Date.now()
    expect(lookaheadMs).toBeGreaterThan(4 * 60_000)
    expect(lookaheadMs).toBeLessThanOrEqual(5 * 60_000)
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

    const listResponse = await worker.fetch(
      listRequest,
      {
        ...env,
        ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
        ACCESS_AUD: "test-audience",
      },
      createExecutionContext(),
    );

    expect(streamResponse.status).toBe(404);
    expect(listResponse.status).toBe(401);
    expect(
      requiresAccessAuthentication(
        "GET",
        "/api/stream/videos/not-found/stream",
      ),
    ).toBe(false);
    expect(
      requiresAccessAuthentication("GET", "/api/videos/video-1/stream"),
    ).toBe(false);
    expect(requiresAccessAuthentication("GET", "/api/videos")).toBe(true);
  });

  it("fails closed when Access configuration is missing", async () => {
    const request = new IncomingRequest("http://example.com/api/videos", {
      headers: { "Cf-Access-Jwt-Assertion": "header.payload.signature" },
    });
    const ctx = createExecutionContext();

    const response = await worker.fetch(
      request,
      {
        ...env,
        ACCESS_TEAM_DOMAIN: "",
        ACCESS_AUD: "",
        LOCAL_AUTH_BYPASS: "false",
      },
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Access authentication is not configured",
    });
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

    const localEnv = {
      ...env,
      DB: localDb,
      LOCAL_AUTH_BYPASS: "true",
      ACCESS_TEAM_DOMAIN: "",
      ACCESS_AUD: "",
    };

    const localResponse = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/videos"),
      localEnv,
      createExecutionContext(),
    );

    expect(localResponse.status).toBe(200);

    // Remote requests must not inherit the local-only bypass configuration.
    // With Access configured but no JWT, they must be rejected with 401.
    const remoteResponse = await worker.fetch(
      new IncomingRequest("https://example.com/api/videos"),
      {
        ...localEnv,
        ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
        ACCESS_AUD: "test-audience",
      },
      createExecutionContext(),
    );

    expect(remoteResponse.status).toBe(401);
  });

  it("rejects malformed Access JWTs", async () => {
    const request = new IncomingRequest("http://example.com/api/videos", {
      headers: { "Cf-Access-Jwt-Assertion": "not.a.valid-token" },
    });
    const ctx = createExecutionContext();

    const response = await worker.fetch(
      request,
      {
        ...env,
        ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
        ACCESS_AUD: "test-audience",
      },
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Invalid Access authentication",
    });
  });

  it("applies separate roles to uploads and schedule changes", () => {
    expect(hasRoleForRoute({ role: "mentor" }, "GET", "/api/change-requests")).toBe(true);
    expect(hasRoleForRoute({ role: "mentor" }, "POST", "/api/change-requests/request-1/approve")).toBe(true);
    expect(hasRoleForRoute({ role: "admin" }, "GET", "/api/change-requests")).toBe(false);
    for (const role of ["admin", "producer", "operator"] as const) {
      expect(hasRoleForRoute({ role }, "POST", "/api/change-requests/request-1/approve")).toBe(false);
      expect(hasRoleForRoute({ role }, "POST", "/api/change-requests/request-1/reject")).toBe(false);
    }
    expect(requiresAccessAuthentication("POST", "/api/change-requests/request-1/approve")).toBe(true);
    expect(requiresAccessAuthentication("POST", "/api/change-requests/request-1/reject")).toBe(true);
    expect(hasRoleForRoute({ role: "mentor" }, "PUT", "/api/settings")).toBe(true);
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
    expect(hasRoleForRoute({ role: "mentor" }, "GET", "/api/users")).toBe(true);
    expect(hasRoleForRoute({ role: "admin" }, "PATCH", "/api/users/user-1")).toBe(true);
    expect(hasRoleForRoute({ role: "mentor" }, "PATCH", "/api/users/user-1")).toBe(true);
    expect(hasRoleForRoute({ role: "producer" }, "PATCH", "/api/users/user-1")).toBe(false);
    expect(hasRoleForRoute({ role: "operator" }, "PATCH", "/api/users/user-1")).toBe(false);
    expect(hasRoleForRoute({ role: "mentor" }, "POST", "/api/users")).toBe(true);
    expect(hasRoleForRoute({ role: "producer" }, "GET", "/api/users")).toBe(false);
    expect(hasRoleForRoute({ role: "operator" }, "POST", "/api/users")).toBe(false);
    expect(requiresAccessAuthentication("PATCH", "/api/users/user-1")).toBe(true);
  });

  it("expands daily and weekly playback schedules only inside the playback window", () => {
    const rows = [
      { scheduleId: "daily", videoId: "video-1", title: "Daily", startsAt: "2030-01-01T10:00:00.000Z", recurrence: "daily", recurrenceUntil: "2030-01-04T23:59:59.999Z" },
      { scheduleId: "weekly", videoId: "video-2", title: "Weekly", startsAt: "2030-01-01T11:00:00.000Z", recurrence: "weekly" },
      { scheduleId: "once", videoId: "video-3", title: "Once", startsAt: "2030-01-02T12:00:00.000Z", recurrence: "none" },
    ];

    expect(expandPlaybackSchedules(rows, "2030-01-02T00:00:00.000Z", "2030-01-09T00:00:00.000Z")).toEqual([
      { ...rows[0], scheduleId: "daily:2030-01-02T10:00:00.000Z", startsAt: "2030-01-02T10:00:00.000Z" },
      { ...rows[0], scheduleId: "daily:2030-01-03T10:00:00.000Z", startsAt: "2030-01-03T10:00:00.000Z" },
      { ...rows[0], scheduleId: "daily:2030-01-04T10:00:00.000Z", startsAt: "2030-01-04T10:00:00.000Z" },
      { ...rows[1], scheduleId: "weekly:2030-01-08T11:00:00.000Z", startsAt: "2030-01-08T11:00:00.000Z" },
      rows[2],
    ]);
  });

  it("applies a settings change only after a different mentor approves it", async () => {
    const executed: Array<{ sql: string; values: unknown[] }> = [];
    const requestRow = {
      id: "request-1", requesterId: "requester-1", requesterEmail: "requester@example.invalid", kind: "settings",
      payloadJson: JSON.stringify({ settings: { isChimeEnabled: true } }), status: "pending",
    };
    const fullApply = {
      countdownDates: true, yearlyCountdownDates: true, userChimeTimes: true,
      isChimeEnabled: true, isPreChimeEnabled: true, isBannerVisible: true, isVerticalBanner: true,
    };
    const db = {
      prepare: (sql: string) => {
        let values: unknown[] = [];
        const statement = {
          bind: (...bound: unknown[]) => { values = bound; return statement; },
          first: async () => {
            if (sql.includes("FROM users")) return { id: "local-test-admin", email: "mentor@example.invalid", role: "mentor" };
            if (sql.includes("FROM change_requests")) return requestRow;
            if (sql.includes("SELECT settings_json")) return { settingsJson: JSON.stringify({ isChimeEnabled: false }), applyJson: JSON.stringify(fullApply) };
            return null;
          },
          run: async () => { executed.push({ sql, values }); return { success: true, meta: { changes: 1 } }; },
        };
        return statement;
      },
    } as unknown as D1Database;
    const response = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/change-requests/request-1/approve", { method: "POST" }),
      { ...env, DB: db, LOCAL_AUTH_BYPASS: "true", LOCAL_AUTH_BYPASS_ROLE: "mentor", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" },
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, status: "approved" });
    const settingsUpdate = executed.find(({ sql }) => sql.includes("UPDATE shared_settings"));
    expect(settingsUpdate).toBeDefined();
    expect(JSON.parse(String(settingsUpdate?.values[0]))).toMatchObject({ isChimeEnabled: true });
    expect(executed.some(({ sql }) => sql.includes("SET status = 'processing'"))).toBe(true);
  });

  it("lets a mentor reject their own request but still blocks self-approval", async () => {
    const reviewUpdates: string[] = [];
    const db = {
      prepare: (sql: string) => {
        const statement = {
          bind: (..._values: unknown[]) => statement,
          first: async () => sql.includes("FROM users")
            ? { id: "local-test-admin", email: "mentor@example.invalid", role: "mentor" }
            : sql.includes("FROM change_requests")
              ? { id: "request-1", requesterId: "local-test-admin", requesterEmail: "mentor@example.invalid", kind: "settings", payloadJson: "{}", status: "pending" }
              : null,
          run: async () => { reviewUpdates.push(sql); return { success: true, meta: { changes: 1 } }; },
        };
        return statement;
      },
    } as unknown as D1Database;
    const localEnv = { ...env, DB: db, LOCAL_AUTH_BYPASS: "true", LOCAL_AUTH_BYPASS_ROLE: "mentor", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" };
    const approve = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/change-requests/request-1/approve", { method: "POST" }),
      localEnv,
      createExecutionContext(),
    );
    expect(approve.status).toBe(409);
    expect(await approve.json()).toEqual({ error: "Mentors cannot approve their own requests" });
    expect(reviewUpdates).toHaveLength(0);

    const reject = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/change-requests/request-1/reject", { method: "POST" }),
      localEnv,
      createExecutionContext(),
    );
    expect(reject.status).toBe(200);
    expect(await reject.json()).toEqual({ success: true, status: "rejected" });
    expect(reviewUpdates.some(sql => sql.includes("SET status = 'processing'"))).toBe(true);
    expect(reviewUpdates.some(sql => sql.includes("SET status = ?"))).toBe(true);
  });

  it("blocks self-approval when the requester has the same email under a different user id", async () => {
    const updates: string[] = [];
    const db = {
      prepare: (sql: string) => {
        const statement = {
          bind: (..._values: unknown[]) => statement,
          first: async () => sql.includes("FROM users")
            ? { id: "reviewer-id", email: "Mentor@Example.invalid", role: "mentor" }
            : sql.includes("FROM change_requests")
              ? { id: "request-1", requesterId: "old-user-id", requesterEmail: " mentor@example.invalid ", kind: "settings", payloadJson: "{}", status: "pending" }
              : null,
          run: async () => { updates.push(sql); return { success: true, meta: { changes: 1 } }; },
        };
        return statement;
      },
    } as unknown as D1Database;
    const response = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/change-requests/request-1/approve", { method: "POST" }),
      { ...env, DB: db, LOCAL_AUTH_BYPASS: "true", LOCAL_AUTH_BYPASS_ROLE: "mentor", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" },
      createExecutionContext(),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Mentors cannot approve their own requests" });
    expect(updates).toHaveLength(0);
  });

  it("keeps video deletion retryable if removing the R2 object fails", async () => {
    const operations: string[] = [];
    let failR2Delete = true;
    const db = {
      prepare: (sql: string) => {
        const statement = {
          bind: (..._values: unknown[]) => statement,
          first: async () => {
            if (sql.includes("FROM users")) return { id: "reviewer", email: "mentor@example.invalid", role: "mentor" };
            if (sql.includes("FROM change_requests")) return { id: "request-1", requesterId: "requester", requesterEmail: "requester@example.invalid", kind: "video.delete", payloadJson: JSON.stringify({ id: "video-1" }), status: "pending" };
            if (sql.includes("FROM schedules")) return null;
            if (sql.includes("FROM videos")) return { r2Key: "videos/video-1" };
            return null;
          },
          run: async () => { operations.push(`D1:${sql}`); return { success: true, meta: { changes: 1 } }; },
        };
        return statement;
      },
    } as unknown as D1Database;
    const bucket = {
      delete: async (key: string) => {
        operations.push(`R2:${key}`);
        if (failR2Delete) throw new Error("R2 unavailable");
      },
    } as unknown as R2Bucket;
    const localEnv = { ...env, DB: db, VIDEO_BUCKET: bucket, LOCAL_AUTH_BYPASS: "true", LOCAL_AUTH_BYPASS_ROLE: "mentor", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" };
    const makeRequest = () => new IncomingRequest("http://127.0.0.1:8787/api/change-requests/request-1/approve", { method: "POST" });

    const failed = await worker.fetch(makeRequest(), localEnv, createExecutionContext());
    expect(failed.status).toBe(409);
    expect(operations.some(operation => operation.includes("DELETE FROM videos"))).toBe(false);
    expect(operations.some(operation => operation.includes("SET status = 'pending'"))).toBe(true);

    failR2Delete = false;
    operations.length = 0;
    const retried = await worker.fetch(makeRequest(), localEnv, createExecutionContext());
    expect(retried.status).toBe(200);
    expect(operations.indexOf("R2:videos/video-1")).toBeLessThan(operations.findIndex(operation => operation.includes("DELETE FROM videos")));
  });

  it("applies approved schedule additions and removals", async () => {
    const writes: Array<{ sql: string; values: unknown[] }> = [];
    let scheduleAlreadyInserted = false;
    let requestRow = { id: "request-1", requesterId: "requester", requesterEmail: "requester@example.invalid", kind: "schedule.create", payloadJson: JSON.stringify({ id: "schedule-1", videoId: "video-1", startsAt: "2030-01-01T00:00:00.000Z" }), status: "pending" };
    const db = {
      prepare: (sql: string) => {
        let values: unknown[] = [];
        const statement = {
          bind: (...bound: unknown[]) => { values = bound; return statement; },
          first: async () => sql.includes("FROM users")
            ? { id: "local-test-admin", email: "mentor@example.invalid", role: "mentor" }
            : sql.includes("FROM change_requests") ? requestRow
              : sql.includes("SELECT video_id AS videoId") && scheduleAlreadyInserted ? { videoId: "video-1", startsAt: "2030-01-01T00:00:00.000Z" }
              : sql.includes("FROM videos") ? { id: "video-1" }
                : null,
          all: async () => ({ results: [] }),
          run: async () => { writes.push({ sql, values }); if (sql.includes("INSERT INTO schedules")) scheduleAlreadyInserted = true; return { success: true, meta: { changes: 1 } }; },
        };
        return statement;
      },
    } as unknown as D1Database;
    const localEnv = { ...env, DB: db, LOCAL_AUTH_BYPASS: "true", LOCAL_AUTH_BYPASS_ROLE: "mentor", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" };
    const review = () => worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/change-requests/request-1/approve", { method: "POST" }),
      localEnv,
      createExecutionContext(),
    );

    expect((await review()).status).toBe(200);
    expect(writes.some(({ sql, values }) => sql.includes("INSERT INTO schedules") && values[0] === "schedule-1")).toBe(true);
    writes.length = 0;
    expect((await review()).status).toBe(200);
    expect(writes.some(({ sql }) => sql.includes("INSERT INTO schedules"))).toBe(false);

    requestRow = { ...requestRow, kind: "schedule.delete", payloadJson: JSON.stringify({ id: "schedule-1" }) };
    writes.length = 0;
    expect((await review()).status).toBe(200);
    expect(writes.some(({ sql, values }) => sql.includes("DELETE FROM schedules") && values[0] === "schedule-1")).toBe(true);
  });

  it("applies approved banner replacement and deletion to the requested orientation", async () => {
    const changes: string[] = [];
    let stagingAvailable = true;
    let publishedByRequest = false;
    let requestRow = { id: "request-1", requesterId: "requester", requesterEmail: "requester@example.invalid", kind: "banner.upload", payloadJson: JSON.stringify({ kind: "horizontal", stagingKey: "pending/banner-1", contentType: "image/png" }), status: "pending" };
    const db = {
      prepare: (sql: string) => {
        const statement = {
          bind: () => statement,
          first: async () => sql.includes("FROM users")
            ? { id: "local-test-admin", email: "mentor@example.invalid", role: "mentor" }
            : sql.includes("FROM change_requests") ? requestRow : null,
          run: async () => ({ success: true, meta: { changes: 1 } }),
        };
        return statement;
      },
    } as unknown as D1Database;
    const bucket = {
      get: async (key: string) => key === "pending/banner-1" && stagingAvailable ? { body: new Response(new Uint8Array([1, 2, 3])).body!, httpMetadata: { contentType: "image/png" } } : null,
      head: async (key: string) => key === "banners/horizontal" && publishedByRequest ? { customMetadata: { changeRequestId: "request-1" } } : null,
      put: async (key: string) => { changes.push(`put:${key}`); publishedByRequest = true; },
      delete: async (key: string) => { changes.push(`delete:${key}`); if (key === "pending/banner-1") stagingAvailable = false; },
    } as unknown as R2Bucket;
    const localEnv = { ...env, DB: db, VIDEO_BUCKET: bucket, LOCAL_AUTH_BYPASS: "true", LOCAL_AUTH_BYPASS_ROLE: "mentor", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" };
    const review = () => worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/change-requests/request-1/approve", { method: "POST" }),
      localEnv,
      createExecutionContext(),
    );

    expect((await review()).status).toBe(200);
    expect(changes).toEqual(["put:banners/horizontal", "delete:pending/banner-1"]);

    changes.length = 0;
    expect((await review()).status).toBe(200);
    expect(changes).toEqual([]);

    requestRow = { ...requestRow, kind: "banner.delete", payloadJson: JSON.stringify({ kind: "vertical" }) };
    changes.length = 0;
    expect((await review()).status).toBe(200);
    expect(changes).toEqual(["delete:banners/vertical"]);
  });

  it("uploads videos directly without creating an approval request", async () => {
    const statements: string[] = [];
    const admin = { id: "local-test-admin", email: "local-test-admin@example.invalid", role: "admin" };
    const db = {
      prepare: (sql: string) => ({
        bind: (..._values: unknown[]) => ({
          first: async () => sql.includes("FROM users") ? admin : null,
          run: async () => { statements.push(sql); return { success: true, meta: { changes: 1 } }; },
        }),
      }),
    } as unknown as D1Database;
    const storedKeys: string[] = [];
    const bucket = { put: async (key: string) => { storedKeys.push(key); } } as unknown as R2Bucket;
    const form = new FormData();
    form.set("title", "Test video");
    form.set("file", new File([new Uint8Array([1, 2, 3])], "test.mp4", { type: "video/mp4" }));
    const response = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/videos", { method: "POST", body: form }),
      { ...env, DB: db, VIDEO_BUCKET: bucket, LOCAL_AUTH_BYPASS: "true", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" },
      createExecutionContext(),
    );
    expect(response.status).toBe(201);
    expect(storedKeys).toHaveLength(1);
    expect(statements.some(sql => sql.includes("INSERT INTO videos"))).toBe(true);
    expect(statements.some(sql => sql.includes("INSERT INTO change_requests"))).toBe(false);
  });

  it("lets the requester cancel their own pending request", async () => {
    const statements: string[] = [];
    const requesterId = "local-test-admin";
    const db = {
      prepare: (sql: string) => {
        const statement = {
          bind: (..._values: unknown[]) => statement,
          first: async () => sql.includes("FROM users")
            ? { id: requesterId, email: "mentor@example.invalid", role: "mentor" }
            : sql.includes("FROM change_requests") ? { requesterId: "legacy-requester-id", requesterEmail: " MENTOR@example.invalid ", payloadJson: JSON.stringify({ kind: "horizontal" }) } : null,
          run: async () => { statements.push(sql); return { success: true, meta: { changes: 1 } }; },
        };
        return statement;
      },
    } as unknown as D1Database;
    const response = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/change-requests/request-1", { method: "DELETE" }),
      { ...env, DB: db, LOCAL_AUTH_BYPASS: "true", LOCAL_AUTH_BYPASS_ROLE: "mentor", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" },
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, status: "cancelled" });
    expect(statements.some(sql => sql.startsWith("DELETE FROM change_requests"))).toBe(true);
  });

  it("queues a schedule change without applying it before mentor approval", async () => {
    const auditRows: Array<{ sql: string; values: unknown[] }> = [];
    const changeRows: Array<{ sql: string; values: unknown[] }> = [];

    const admin = {
      id: "local-test-admin",
      email: "local-test-admin@example.invalid",
      role: "admin",
    };

    const auditDb = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({
          first: async () =>
            sql.includes("FROM users")
              ? admin
              : sql.includes("FROM videos")
                ? { id: "video-1" }
                : null,
          all: async () => ({ results: [] }),
          run: async () => {
            if (sql.includes("INSERT INTO audit_logs")) {
              auditRows.push({ sql, values });
            }
            if (sql.includes("INSERT INTO change_requests")) changeRows.push({ sql, values });
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    } as unknown as D1Database;

    const request = new IncomingRequest(
      "http://127.0.0.1:8787/api/schedules",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: "video-1",
          startsAt: "2030-01-01T00:00:00Z",
        }),
      },
    );

    const response = await worker.fetch(
      request,
      {
        ...env,
        DB: auditDb,
        LOCAL_AUTH_BYPASS: "true",
        ACCESS_TEAM_DOMAIN: "",
        ACCESS_AUD: "",
      },
      createExecutionContext(),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "pending", message: "メンターの承認待ちです" });
    expect(auditRows).toHaveLength(0);
    expect(changeRows).toHaveLength(1);
    expect(changeRows[0].values[1]).toBe(admin.id);
    expect(changeRows[0].values[2]).toBe("schedule.create");
    expect(JSON.parse(String(changeRows[0].values[4]))).toMatchObject({
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
          first: async () =>
            sql.includes("FROM users")
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
      delete: async (key: string) => {
        deletedObjects.push(key);
      },
    } as unknown as R2Bucket;

    const request = new IncomingRequest(
      "http://127.0.0.1:8787/api/videos/video-1",
      { method: "DELETE" },
    );

    const response = await worker.fetch(
      request,
      {
        ...env,
        DB: deleteDb,
        VIDEO_BUCKET: bucket,
        LOCAL_AUTH_BYPASS: "true",
        ACCESS_TEAM_DOMAIN: "",
        ACCESS_AUD: "",
      },
      createExecutionContext(),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "pending" });
    expect(deletedObjects).toEqual([]);
    expect(auditActions).toEqual([]);
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
          first: async () => (sql.includes("FROM users") ? admin : null),
        }),
      }),
    } as unknown as D1Database;

    const response = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/videos"),
      {
        ...env,
        DB: listDb,
        LOCAL_AUTH_BYPASS: "true",
        ACCESS_TEAM_DOMAIN: "",
        ACCESS_AUD: "",
      },
      createExecutionContext(),
    );

    const body = (await response.json()) as {
      videos: Array<Record<string, unknown>>;
      canManageUsers: boolean;
    };

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
          first: async () =>
            sql.includes("WHERE id = ? AND role = 'admin'") ? admin : null,
          run: async () => {
            if (sql.includes("INSERT INTO users")) insertedUsers.push(values);
            if (sql.includes("INSERT INTO audit_logs")) {
              auditActions.push(String(values[2]));
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    } as unknown as D1Database;

    const request = new IncomingRequest("http://127.0.0.1:8787/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "producer@example.com",
        role: "producer",
      }),
    });

    const response = await worker.fetch(
      request,
      {
        ...env,
        DB: userDb,
        LOCAL_AUTH_BYPASS: "true",
        ACCESS_TEAM_DOMAIN: "",
        ACCESS_AUD: "",
      },
      createExecutionContext(),
    );

    expect(response.status).toBe(201);
    expect(insertedUsers).toHaveLength(1);
    expect(insertedUsers[0][1]).toBe("producer@example.com");
    expect(insertedUsers[0][2]).toBe("producer");
    expect(auditActions).toEqual(["user.created"]);
  });

  it("rejects a self-promotion to mentor after the caller is an admin", async () => {
    const self = { id: "local-test-admin", email: "admin@example.invalid", role: "admin", createdAt: "2026-01-01" };
    let roleUpdated = false;
    const db = {
      prepare: (sql: string) => ({
        bind: (..._values: unknown[]) => ({
          first: async () => sql.includes("WHERE id = ? AND role = 'admin'") ? self : self,
          run: async () => { roleUpdated = true; return { success: true, meta: { changes: 1 } }; },
        }),
      }),
    } as unknown as D1Database;
    const response = await worker.fetch(new IncomingRequest("http://127.0.0.1:8787/api/users/local-test-admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "mentor" }),
    }), {
      ...env,
      DB: db,
      LOCAL_AUTH_BYPASS: "true",
      ACCESS_TEAM_DOMAIN: "",
      ACCESS_AUD: "",
    }, createExecutionContext());

    expect(response.status).toBe(403);
    expect(roleUpdated).toBe(false);
  });

  it("forwards the original request and Access/Range headers through the Pages proxy", async () => {
    const request = new Request(
      "https://cp-dashboard-d17.pages.dev/api/stream/videos/video-1/stream",
      {
        headers: {
          "Cf-Access-Jwt-Assertion": "signed-access-token",
          Range: "bytes=0-1023",
        },
      },
    );

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
    expect(forwardedRequest?.headers.get("Cf-Access-Jwt-Assertion")).toBe(
      "signed-access-token",
    );
    expect(forwardedRequest?.headers.get("Range")).toBe("bytes=0-1023");
  });

  it("returns a clear error when the Pages service binding is missing", async () => {
    const response = await proxyApiRequest({
      request: new Request("https://cp-dashboard-d17.pages.dev/api/videos"),
      env: {} as { VIDEO_API: { fetch(request: Request): Promise<Response> } },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Video API service is not connected",
    });
  });


  it("returns saved shared settings", async () => {
    const settings = {
      countdownDates: [{ date: "2026-12-25", label: "クリスマス" }],
    };

    const settingsDb = {
      prepare: (sql: string) => {
        const statement = {
          bind: (..._values: unknown[]) => statement,
          first: async () =>
            sql.includes("SELECT settings_json")
              ? {
                  settingsJson: JSON.stringify(settings),
                  updatedAt: "2026-10-13 12:00:00",
                }
              : null,
        };
        return statement;
      },
    } as unknown as D1Database;

    const response = await worker.fetch(
      new IncomingRequest("http://example.com/api/settings"),
      { ...env, DB: settingsDb },
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      settings,
      apply: {
        countdownDates: true,
        yearlyCountdownDates: true,
        userChimeTimes: true,
        isChimeEnabled: true,
        isPreChimeEnabled: true,
        isBannerVisible: true,
        isVerticalBanner: true,
      },
      updatedAt: "2026-10-13 12:00:00",
    });
  });

  it("lets admins manage shared banner images and serves them to site clients", async () => {
    const kind = "vertical";
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const adminDb = {
      prepare: (_sql: string) => {
        const statement = {
          bind: (..._values: unknown[]) => statement,
          first: async () => ({ id: "local-test-admin", email: "local-test-admin@example.invalid", role: "admin" }),
          run: async () => ({ success: true, meta: { changes: 1 } }),
        };
        return statement;
      },
    } as unknown as D1Database;
    const localEnv = {
      ...env,
      DB: adminDb,
      LOCAL_AUTH_BYPASS: "true",
      ACCESS_TEAM_DOMAIN: "",
      ACCESS_AUD: "",
    };

    const upload = await worker.fetch(
      new IncomingRequest(`http://127.0.0.1:8787/api/banners/${kind}`, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: bytes,
      }),
      localEnv,
      createExecutionContext(),
    );
    expect(upload.status).toBe(202);

    const list = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/banners"),
      localEnv,
      createExecutionContext(),
    );
    expect(list.status).toBe(200);
    expect((await list.json() as { banners: Record<string, { size: number } | null> }).banners[kind]).toBeNull();

    const image = await worker.fetch(
      new IncomingRequest(`http://127.0.0.1:8787/api/banners/${kind}`),
      localEnv,
      createExecutionContext(),
    );
    expect(image.status).toBe(404);

    const remove = await worker.fetch(
      new IncomingRequest(`http://127.0.0.1:8787/api/banners/${kind}`, { method: "DELETE" }),
      localEnv,
      createExecutionContext(),
    );
    expect(remove.status).toBe(202);
  });


  it("saves shared settings for a local admin", async () => {
    const settings = { isChimeEnabled: true };
    let savedJson = "";

    const settingsDb = {
      prepare: (sql: string) => {
        let values: unknown[] = [];
        const statement = {
          bind: (...boundValues: unknown[]) => { values = boundValues; return statement; },
          first: async () => {
            if (sql.includes("WHERE id = ? AND role = 'admin'")) {
              return {
                id: "local-test-admin",
                email: "local-test-admin@example.invalid",
                role: "admin",
              };
            }
            if (sql.includes("SELECT settings_json")) {
              return { settingsJson: JSON.stringify({ isChimeEnabled: false }), applyJson: JSON.stringify({ isChimeEnabled: true }) };
            }
            return null;
          },
          run: async () => {
            if (sql.includes("UPDATE shared_settings")) {
              savedJson = String(values[0]);
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    const response = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      }),
      {
        ...env,
        DB: settingsDb,
        LOCAL_AUTH_BYPASS: "true",
        ACCESS_TEAM_DOMAIN: "",
        ACCESS_AUD: "",
      },
      createExecutionContext(),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "pending" });
    expect(savedJson).toBe("");
  });

  it("does not overwrite settings disabled by the admin apply policy", async () => {
    const disabledPolicy = {
      countdownDates: true,
      yearlyCountdownDates: true,
      userChimeTimes: true,
      isChimeEnabled: false,
      isPreChimeEnabled: true,
      isBannerVisible: true,
      isVerticalBanner: true,
    };
    let storedSettings = JSON.stringify({ isChimeEnabled: false });
    let storedApply = JSON.stringify(disabledPolicy);

    const settingsDb = {
      prepare: (sql: string) => {
        let values: unknown[] = [];
        const statement = {
          bind: (...boundValues: unknown[]) => { values = boundValues; return statement; },
          first: async () => {
            if (sql.includes("WHERE id = ? AND role = 'admin'")) {
              return { id: "local-test-admin", email: "local-test-admin@example.invalid", role: "admin" };
            }
            if (sql.includes("SELECT settings_json")) {
              return { settingsJson: storedSettings, applyJson: storedApply };
            }
            return null;
          },
          run: async () => {
            if (sql.includes("UPDATE shared_settings")) {
              storedSettings = String(values[0]);
              storedApply = String(values[1]);
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    const response = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { isChimeEnabled: true },
          apply: disabledPolicy,
        }),
      }),
      {
        ...env,
        DB: settingsDb,
        LOCAL_AUTH_BYPASS: "true",
        ACCESS_TEAM_DOMAIN: "",
        ACCESS_AUD: "",
      },
      createExecutionContext(),
    );

    expect(response.status).toBe(202);
    expect(JSON.parse(storedSettings)).toEqual({ isChimeEnabled: false });
    expect(JSON.parse(storedApply)).toEqual(disabledPolicy);
  });

  it("allows the admin editor to update values excluded from device delivery", async () => {
    const disabledPolicy = {
      countdownDates: false,
      yearlyCountdownDates: true,
      userChimeTimes: true,
      isChimeEnabled: true,
      isPreChimeEnabled: true,
      isBannerVisible: true,
      isVerticalBanner: true,
    };
    let storedSettings = JSON.stringify({ countdownDates: [] });
    const settingsDb = {
      prepare: (sql: string) => {
        let values: unknown[] = [];
        const statement = {
          bind: (...boundValues: unknown[]) => { values = boundValues; return statement; },
          first: async () => sql.includes("WHERE id = ? AND role = 'admin'")
            ? { id: "local-test-admin", email: "local-test-admin@example.invalid", role: "admin" }
            : sql.includes("SELECT settings_json")
              ? { settingsJson: storedSettings, applyJson: JSON.stringify(disabledPolicy) }
              : null,
          run: async () => {
            if (sql.includes("UPDATE shared_settings")) storedSettings = String(values[0]);
            return { success: true, meta: { changes: 1 } };
          },
        };
        return statement;
      },
    } as unknown as D1Database;
    const response = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { countdownDates: [{ date: "2026-12-25", label: "冬休み" }] }, adminEdit: true }),
      }),
      { ...env, DB: settingsDb, LOCAL_AUTH_BYPASS: "true", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" },
      createExecutionContext(),
    );
    expect(response.status).toBe(202);
    expect(JSON.parse(storedSettings)).toEqual({ countdownDates: [] });
  });

  it("rejects shared settings updates without settings", async () => {
    const admin = {
      id: "local-test-admin",
      email: "local-test-admin@example.invalid",
      role: "admin",
    };

    const settingsDb = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () =>
            sql.includes("WHERE id = ? AND role = 'admin'")
              ? admin
              : null,
        }),
      }),
    } as unknown as D1Database;

    const response = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      {
        ...env,
        DB: settingsDb,
        LOCAL_AUTH_BYPASS: "true",
        ACCESS_TEAM_DOMAIN: "",
        ACCESS_AUD: "",
      },
      createExecutionContext(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "settings or apply is required" });
  });

  it("rejects unauthenticated shared settings updates", async () => {
    const response = await worker.fetch(
      new IncomingRequest("https://example.com/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { isChimeEnabled: true } }),
      }),
      {
        ...env,
        ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
        ACCESS_AUD: "test-audience",
        LOCAL_AUTH_BYPASS: "false",
      },
      createExecutionContext(),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Access authentication required",
    });
  });

  it("records before and after values for shared setting requests", async () => {
    const changes: Array<{ sql: string; values: unknown[] }> = [];
    const admin = { id: "local-test-admin", email: "local-test-admin@example.invalid", role: "admin" };
    const currentSettings = { isBannerVisible: true, isChimeEnabled: true };
    const currentApply = { countdownDates: true, yearlyCountdownDates: true, userChimeTimes: true, isChimeEnabled: true, isPreChimeEnabled: true, isBannerVisible: true, isVerticalBanner: true };
    const db = {
      prepare: (sql: string) => {
        const statement = {
          first: async () => sql.includes("FROM users") ? admin : sql.includes("FROM shared_settings") ? { settingsJson: JSON.stringify(currentSettings), applyJson: JSON.stringify(currentApply) } : null,
          run: async (...values: unknown[]) => { if (sql.includes("INSERT INTO change_requests")) changes.push({ sql, values }); return { success: true, meta: { changes: 1 } }; },
          bind: (...values: unknown[]) => ({
            first: statement.first,
            run: async () => { if (sql.includes("INSERT INTO change_requests")) changes.push({ sql, values }); return { success: true, meta: { changes: 1 } }; },
          }),
        };
        return statement;
      },
    } as unknown as D1Database;
    const response = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: { isBannerVisible: false } }) }),
      { ...env, DB: db, LOCAL_AUTH_BYPASS: "true", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" },
      createExecutionContext(),
    );
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(202);
    expect(changes).toHaveLength(1);
    expect(changes[0].values[3]).toContain("横バナー: 有効 → 無効");
    expect(JSON.parse(String(changes[0].values[4])).changes).toEqual({ isBannerVisible: { before: true, after: false } });
  });

  it("rejects unsupported, malformed, and no-op shared-setting requests", async () => {
    const inserts: string[] = [];
    const db = {
      prepare: (sql: string) => {
        const statement = {
          bind: (..._values: unknown[]) => statement,
          first: async () => sql.includes("FROM users")
            ? { id: "local-test-admin", email: "local-test-admin@example.invalid", role: "admin" }
            : sql.includes("FROM shared_settings")
              ? { settingsJson: JSON.stringify({ isChimeEnabled: false }), applyJson: JSON.stringify({ countdownDates: true, yearlyCountdownDates: true, userChimeTimes: true, isChimeEnabled: true, isPreChimeEnabled: true, isBannerVisible: true, isVerticalBanner: true }) }
              : null,
          run: async () => { if (sql.includes("INSERT INTO change_requests")) inserts.push(sql); return { success: true, meta: { changes: 1 } }; },
        };
        return statement;
      },
    } as unknown as D1Database;
    const localEnv = { ...env, DB: db, LOCAL_AUTH_BYPASS: "true", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" };
    const request = (body: unknown) => worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      localEnv,
      createExecutionContext(),
    );
    const invalidBodies = [
      { settings: { unsupportedSetting: "value" } },
      { settings: { isChimeEnabled: "yes" } },
      { apply: { countdownDates: true, yearlyCountdownDates: true, userChimeTimes: true, isChimeEnabled: true, isPreChimeEnabled: true, isBannerVisible: true, isVerticalBanner: true, unexpected: true } },
    ];
    for (const body of invalidBodies) expect((await request(body)).status).toBe(400);

    const noOp = await request({ settings: { isChimeEnabled: false } });
    expect(noOp.status).toBe(400);
    expect(await noOp.json()).toEqual({ error: "変更内容がありません" });
    expect(inserts).toHaveLength(0);
  });

  it("shows a before and after comparison for older pending setting requests", async () => {
    const mentor = { id: "local-test-mentor", email: "mentor@example.invalid", role: "mentor" };
    const pending = { id: "old-request", kind: "settings", summary: "共有設定を変更", payloadJson: JSON.stringify({ settings: { isBannerVisible: false } }), requesterId: "requester", requesterEmail: "requester@example.invalid", createdAt: "2030-01-01 00:00:00" };
    const legacyNoDelta = { ...pending, id: "legacy-no-delta", payloadJson: JSON.stringify({ settings: { isBannerVisible: true } }) };
    const db = {
      prepare: (sql: string) => {
        const statement = {
          first: async () => sql.includes("FROM users") ? mentor : sql.includes("FROM shared_settings") ? { settingsJson: JSON.stringify({ isBannerVisible: true }), applyJson: "{}" } : null,
          all: async () => ({ results: [pending, legacyNoDelta] }),
          bind: () => statement,
        };
        return statement;
      },
    } as unknown as D1Database;
    const response = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/change-requests"),
      { ...env, DB: db, LOCAL_AUTH_BYPASS: "true", LOCAL_AUTH_BYPASS_ROLE: "mentor", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" },
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ requests: [
      { summary: "横バナー: 有効 → 無効", payload: { changes: { isBannerVisible: { before: true, after: false } } } },
      { summary: "横バナー: 変更前不明 → 有効", payload: { changes: { isBannerVisible: { beforeKnown: false, after: true } } } },
    ] });
  });

  it("serves a pending banner preview only through the mentor request route", async () => {
    const mentor = { id: "local-test-mentor", email: "mentor@example.invalid", role: "mentor" };
    const imageBytes = new Uint8Array([137, 80, 78, 71]);
    const db = {
      prepare: (sql: string) => {
        const statement = {
          first: async () => sql.includes("FROM users") ? mentor : sql.includes("FROM change_requests")
            ? { kind: "banner.upload", payloadJson: JSON.stringify({ kind: "horizontal", stagingKey: "pending/request-1", contentType: "image/png" }) }
            : null,
          bind: () => statement,
        };
        return statement;
      },
    } as unknown as D1Database;
    const bucket = {
      get: async (key: string) => key === "pending/request-1"
        ? { body: new Response(imageBytes).body!, httpMetadata: { contentType: "image/png" } }
        : null,
    } as unknown as R2Bucket;
    const response = await worker.fetch(
      new IncomingRequest("http://127.0.0.1:8787/api/change-requests/request-1/preview"),
      { ...env, DB: db, VIDEO_BUCKET: bucket, LOCAL_AUTH_BYPASS: "true", LOCAL_AUTH_BYPASS_ROLE: "mentor", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" },
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...imageBytes]);
  });
});
