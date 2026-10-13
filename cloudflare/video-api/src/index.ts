interface Env {

  DB: D1Database;

  VIDEO_BUCKET: R2Bucket;

  ACCESS_TEAM_DOMAIN?: string;

  ACCESS_AUD?: string;

  LOCAL_AUTH_BYPASS?: string;

}

const allowedOrigin = "http://localhost:3000";

const localAdminId = "local-test-admin";

type UserRole = "admin" | "producer" | "operator";

interface ApiUser {
  id: string;
  email: string;
  role: UserRole;
}

interface AccessClaims {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  sub?: unknown;
  email?: unknown;
}

interface AccessJwk extends JsonWebKey {
  kid?: string;
  use?: string;
  alg?: string;
}

let accessKeysCache: {
  issuer: string;
  expiresAt: number;
  keys: AccessJwk[];
} | null = null;

export function requiresAccessAuthentication(method: string, pathname: string): boolean {
  return (
    (method === "GET" &&
      ["/api/schedules", "/api/videos", "/api/users"].includes(pathname)) ||
    (method === "POST" && ["/api/schedules", "/api/videos", "/api/users"].includes(pathname)) ||
    (method === "DELETE" && pathname.startsWith("/api/schedules/") && pathname !== "/api/schedules/") ||
    (method === "DELETE" && /^\/api\/videos\/[^/]+$/.test(pathname)) ||
    (method === "PATCH" && /^\/api\/users\/[^/]+$/.test(pathname))
  );
}

export function hasRoleForRoute(user: Pick<ApiUser, "role">, method: string, pathname: string): boolean {
  if (
    (method === "GET" && pathname === "/api/users") ||
    (method === "POST" && pathname === "/api/users") ||
    (method === "PATCH" && /^\/api\/users\/[^/]+$/.test(pathname))
  ) {
    return user.role === "admin";
  }

  if (method === "POST" && pathname === "/api/videos") {
    return user.role === "admin" || user.role === "producer";
  }

  if (
    (method === "POST" && pathname === "/api/schedules") ||
    (method === "DELETE" && pathname.startsWith("/api/schedules/"))
  ) {
    return user.role === "admin" || user.role === "operator";
  }

  if (method === "DELETE" && /^\/api\/videos\/[^/]+$/.test(pathname)) {
    return user.role === "admin" || user.role === "producer";
  }

  return true;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function decodeJwtPart<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

async function getAccessKeys(issuer: string): Promise<AccessJwk[] | null> {
  if (accessKeysCache && accessKeysCache.issuer === issuer && accessKeysCache.expiresAt > Date.now()) {
    return accessKeysCache.keys;
  }

  try {
    const certsUrl = new URL("/cdn-cgi/access/certs", issuer);
    const response = await fetch(certsUrl.toString(), { cf: { cacheTtl: 300 } });
    if (!response.ok) return null;

    const body = await response.json() as { keys?: AccessJwk[] };
    if (!Array.isArray(body.keys)) return null;

    accessKeysCache = {
      issuer,
      expiresAt: Date.now() + 5 * 60_000,
      keys: body.keys,
    };
    return body.keys;
  } catch {
    return null;
  }
}

async function getAccessUser(request: Request, env: Env): Promise<{
  user: ApiUser | null;
  response: Response | null;
}> {
  const requestHost = new URL(request.url).hostname;
  const isLoopback = requestHost === "localhost" || requestHost === "127.0.0.1" || requestHost === "[::1]";

  // Local browser testing can opt in explicitly when starting Wrangler.
  // This cannot be enabled by a request header and never applies to remote hosts.
  if (
    env.LOCAL_AUTH_BYPASS === "true" &&
    isLoopback &&
    !env.ACCESS_TEAM_DOMAIN &&
    !env.ACCESS_AUD
  ) {
    const localAdmin = await env.DB.prepare(`
      SELECT id, email, role
      FROM users
      WHERE id = ? AND role = 'admin'
    `)
      .bind(localAdminId)
      .first<{ id: string; email: string; role: string }>();

    if (!localAdmin) {
      return { user: null, response: jsonError("Local test admin not found", 403) };
    }

    return {
      user: { id: localAdmin.id, email: localAdmin.email, role: "admin" },
      response: null,
    };
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    return { user: null, response: jsonError("Access authentication required", 401) };
  }

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return { user: null, response: jsonError("Access authentication is not configured", 503) };
  }

  let issuer: string;
  try {
    const teamUrl = new URL(env.ACCESS_TEAM_DOMAIN);
    if (teamUrl.protocol !== "https:" || teamUrl.pathname !== "/" || teamUrl.search || teamUrl.hash) {
      throw new Error("Invalid Access team domain");
    }
    issuer = teamUrl.origin;
  } catch {
    return { user: null, response: jsonError("Access authentication is not configured", 503) };
  }

  try {
    if (token.length > 16_384) throw new Error("Token too large");
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Malformed token");

    const header = decodeJwtPart<{ alg?: unknown; kid?: unknown }>(parts[0]);
    const claims = decodeJwtPart<AccessClaims>(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string") {
      throw new Error("Unsupported token signature");
    }

    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const now = Math.floor(Date.now() / 1000);
    if (
      claims.iss !== issuer ||
      !audiences.includes(env.ACCESS_AUD) ||
      typeof claims.exp !== "number" || claims.exp <= now ||
      (typeof claims.nbf === "number" && claims.nbf > now) ||
      typeof claims.email !== "string" || !claims.email.includes("@")
    ) {
      throw new Error("Invalid token claims");
    }

    const keys = await getAccessKeys(issuer);
    if (!keys) {
      return { user: null, response: jsonError("Access signing keys are unavailable", 503) };
    }
    const jwk = keys.find(key => key.kid === header.kid && (!key.use || key.use === "sig"));
    if (!jwk) throw new Error("Unknown signing key");

    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const validSignature = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!validSignature) throw new Error("Invalid token signature");

    const user = await env.DB.prepare(`
      SELECT id, email, role
      FROM users
      WHERE lower(email) = lower(?)
    `)
      .bind(claims.email.trim())
      .first<{ id: string; email: string; role: string }>();

    if (!user || !["admin", "producer", "operator"].includes(user.role)) {
      return { user: null, response: jsonError("User is not authorized", 403) };
    }

    return { user: { id: user.id, email: user.email, role: user.role as UserRole }, response: null };
  } catch {
    return { user: null, response: jsonError("Invalid Access authentication", 401) };
  }
}

function withCors(response: Response, origin: string | null): Response {

  const headers = new Headers(response.headers);

  if (origin === allowedOrigin) {

    headers.set("Access-Control-Allow-Origin", allowedOrigin);

    headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");

    headers.set("Access-Control-Allow-Headers", "Content-Type");

    headers.set("Vary", "Origin");

  }

  return new Response(response.body, {

    status: response.status,

    statusText: response.statusText,

    headers,

  });

}

function jsonError(message: string, status: number): Response {

  return Response.json({ error: message }, { status });

}

function isUserRole(value: unknown): value is UserRole {
  return value === "admin" || value === "producer" || value === "operator";
}

async function recordAuditLog(
  env: Env,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  details?: Record<string, string | number | boolean>,
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO audit_logs (
        id,
        actor_id,
        action,
        target_type,
        target_id,
        details
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .bind(
        crypto.randomUUID(),
        actorId,
        action,
        targetType,
        targetId,
        details ? JSON.stringify(details) : null,
      )
      .run();
  } catch (error) {
    // An audit failure must not report a successful D1/R2 operation as failed.
    console.error("Failed to record audit log:", error);
  }
}

export default {

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {

    const origin = request.headers.get("Origin");

    const url = new URL(request.url);

    let accessUser: ApiUser | null = null;
    let authResponse: Response | null = null;

    if (request.method !== "OPTIONS" && requiresAccessAuthentication(request.method, url.pathname)) {
      const authentication = await getAccessUser(request, env);
      if (authentication.response) {
        authResponse = authentication.response;
      } else if (authentication.user && !hasRoleForRoute(authentication.user, request.method, url.pathname)) {
        authResponse = jsonError("Insufficient permissions", 403);
      } else {
        accessUser = authentication.user;
      }
    }

let response: Response = jsonError("Not Found", 404);

    if (request.method === "OPTIONS") {

      response = new Response(null, { status: 204 });

    } else if (authResponse) {

      response = authResponse;

    } else if (request.method === "GET" && url.pathname === "/api/users") {

      try {
        const result = await env.DB.prepare(`
          SELECT id, email, role, created_at AS createdAt
          FROM users
          ORDER BY lower(email) ASC
        `).all();
        response = Response.json({ users: result.results });
      } catch (error) {
        console.error("Failed to retrieve users:", error);
        response = jsonError("Failed to retrieve users", 500);
      }

    } else if (request.method === "POST" && url.pathname === "/api/users") {

      try {
        const body: unknown = await request.json();
        if (typeof body !== "object" || body === null || !("email" in body) || !("role" in body)) {
          response = jsonError("email and role are required", 400);
        } else {
          const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
          const role = body.role;
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !isUserRole(role)) {
            response = jsonError("A valid email and role are required", 400);
          } else {
            const existing = await env.DB.prepare(`
              SELECT id FROM users WHERE lower(email) = lower(?) LIMIT 1
            `)
              .bind(email)
              .first<{ id: string }>();
            if (existing) {
              response = jsonError("User already exists", 409);
            } else {
              const id = crypto.randomUUID();
              await env.DB.prepare(`
                INSERT INTO users (id, email, role)
                VALUES (?, ?, ?)
              `)
                .bind(id, email, role)
                .run();
              await recordAuditLog(env, accessUser!.id, "user.created", "user", id, { email, role });
              response = Response.json({ user: { id, email, role } }, { status: 201 });
            }
          }
        }
      } catch (error) {
        console.error("Failed to create user:", error);
        response = jsonError("Failed to create user", 500);
      }

    } else if (request.method === "PATCH" && /^\/api\/users\/[^/]+$/.test(url.pathname)) {

      try {
        const id = decodeURIComponent(url.pathname.slice("/api/users/".length));
        const body: unknown = await request.json();
        if (!id || id.includes("/")) {
          response = jsonError("Invalid user ID", 400);
        } else if (typeof body !== "object" || body === null || !("role" in body) || !isUserRole(body.role)) {
          response = jsonError("A valid role is required", 400);
        } else {
          const user = await env.DB.prepare(`
            SELECT id, email, role, created_at AS createdAt
            FROM users
            WHERE id = ?
          `)
            .bind(id)
            .first<{ id: string; email: string; role: UserRole; createdAt: string }>();

          if (!user) {
            response = jsonError("User not found", 404);
          } else if (user.id === accessUser!.id && body.role !== "admin") {
            response = jsonError("You cannot remove your own admin role", 409);
          } else if (user.role === body.role) {
            response = Response.json({ user });
          } else {
            const result = await env.DB.prepare(`
              UPDATE users
              SET role = ?
              WHERE id = ?
                AND (role != 'admin' OR (SELECT COUNT(*) FROM users WHERE role = 'admin') > 1)
            `)
              .bind(body.role, id)
              .run();

            if (result.meta.changes === 0) {
              response = jsonError("At least one administrator must remain", 409);
            } else {
              await recordAuditLog(env, accessUser!.id, "user.role_updated", "user", id, {
                email: user.email,
                fromRole: user.role,
                toRole: body.role,
              });
              response = Response.json({ user: { ...user, role: body.role } });
            }
          }
        }
      } catch (error) {
        console.error("Failed to update user role:", error);
        response = jsonError("Failed to update user role", 500);
      }

    } else if (

      request.method === "GET" &&

      url.pathname === "/api/health"

    ) {

      try {

        await env.DB.prepare("SELECT 1").first();

        response = Response.json({

          status: "ok",

          database: "connected",

        });

      } catch (error) {

        console.error("Database health check failed:", error);

        response = jsonError("Database unavailable", 500);

      }

    } else if (

      request.method === "GET" &&

      url.pathname === "/api/schedule"

    ) {

      try {

        const now = new Date();

        // Allow connected playback clients to recover from a short polling pause.
        const windowStart = new Date(now.getTime() - 60_000).toISOString();

        const windowEnd = new Date(now.getTime() + 5_000).toISOString();

        const result = await env.DB.prepare(`

          SELECT

            s.id AS scheduleId,

            s.video_id AS videoId,

            v.title AS title,

            s.starts_at AS startsAt

          FROM schedules s

          JOIN videos v ON v.id = s.video_id

          WHERE s.starts_at > ?

            AND s.starts_at <= ?

          ORDER BY s.starts_at ASC

        `)

          .bind(windowStart, windowEnd)

          .all();

        response = Response.json({

          serverTime: now.toISOString(),

          schedules: result.results,

        });

      } catch (error) {

        console.error("Failed to retrieve playback schedule:", error);

        response = jsonError("Failed to retrieve schedule", 500);

      }

    } else if (

      request.method === "GET" &&

      url.pathname === "/api/schedules"

    ) {

      try {

        const result = await env.DB.prepare(`

          SELECT

            s.id AS id,

            s.video_id AS videoId,

            v.title AS title,

            s.starts_at AS startsAt,

            s.created_by AS createdBy

          FROM schedules s

          JOIN videos v ON v.id = s.video_id

          ORDER BY s.starts_at ASC

        `).all();

        response = Response.json({

          schedules: result.results,

        });

      } catch (error) {

        console.error("Failed to retrieve schedules:", error);

        response = jsonError("Failed to retrieve schedules", 500);

      }

    } else if (

      request.method === "POST" &&

      url.pathname === "/api/schedules"

    ) {

      try {

        const body: unknown = await request.json();

        if (

          typeof body !== "object" ||

          body === null ||

          !("videoId" in body) ||

          !("startsAt" in body) ||

          typeof body.videoId !== "string" ||

          typeof body.startsAt !== "string" ||

          body.videoId.trim() === "" ||

          body.startsAt.trim() === ""

        ) {

          response = jsonError(

            "videoId and startsAt are required",

            400,

          );

        } else {

          const startsAtDate = new Date(body.startsAt);

          if (Number.isNaN(startsAtDate.getTime())) {

            response = jsonError("Invalid startsAt", 400);

          } else {

            const video = await env.DB.prepare(`

              SELECT id

              FROM videos

              WHERE id = ?

            `)

              .bind(body.videoId)

              .first();

            if (!video) {

              response = jsonError("Video not found", 404);

            } else {

                const id = crypto.randomUUID();

                const normalizedStartsAt = startsAtDate.toISOString();

                await env.DB.prepare(`

                  INSERT INTO schedules (

                    id,

                    video_id,

                    starts_at,

                    created_by

                  )

                  VALUES (?, ?, ?, ?)

                `)

                  .bind(

                    id,

                    body.videoId,

                    normalizedStartsAt,

                    accessUser!.id,

                  )

                  .run();

                await recordAuditLog(env, accessUser!.id, "schedule.created", "schedule", id, {
                  videoId: body.videoId,
                  startsAt: normalizedStartsAt,
                });

                response = Response.json(

                  {

                    schedule: {

                      id,

                      videoId: body.videoId,

                      startsAt: normalizedStartsAt,

                      createdBy: accessUser!.id,

                    },

                  },

                  { status: 201 },

                );

              }

            }

          }

      } catch (error) {

        console.error("Failed to create schedule:", error);

        response = jsonError("Failed to create schedule", 500);

      }

    } else if (

      request.method === "DELETE" &&

      url.pathname.startsWith("/api/schedules/")

    ) {

      try {

        const id = decodeURIComponent(

          url.pathname.slice("/api/schedules/".length),

        );

        if (!id || id.includes("/")) {

          response = jsonError("Invalid schedule ID", 400);

        } else {

          const result = await env.DB.prepare(`

            DELETE FROM schedules

            WHERE id = ?

          `)

            .bind(id)

            .run();

          if (result.meta.changes === 0) {

            response = jsonError("Schedule not found", 404);

          } else {

            await recordAuditLog(env, accessUser!.id, "schedule.deleted", "schedule", id);

            response = Response.json({

              success: true,

              deletedId: id,

            });

          }

        }

      } catch (error) {

        console.error("Failed to delete schedule:", error);

        response = jsonError("Failed to delete schedule", 500);

      }

    } else if (

      request.method === "DELETE" &&

      /^\/api\/videos\/[^/]+$/.test(url.pathname)

    ) {

      try {

        const id = decodeURIComponent(url.pathname.slice("/api/videos/".length));

        if (!id || id.includes("/")) {

          response = jsonError("Invalid video ID", 400);

        } else {

          const video = await env.DB.prepare(`
            SELECT r2_key AS r2Key, uploaded_by AS uploadedBy
            FROM videos
            WHERE id = ?
          `)
            .bind(id)
            .first<{ r2Key: string; uploadedBy: string }>();

          if (!video) {

            response = jsonError("Video not found", 404);

          } else if (accessUser!.role !== "admin" && video.uploadedBy !== accessUser!.id) {

            response = jsonError("You can only delete videos you uploaded", 403);

          } else {

            const schedule = await env.DB.prepare(`
              SELECT id
              FROM schedules
              WHERE video_id = ?
              LIMIT 1
            `)
              .bind(id)
              .first<{ id: string }>();

            if (schedule) {

              response = jsonError("Remove this video's schedules before deleting it", 409);

            } else {

              const result = await env.DB.prepare(`
                DELETE FROM videos
                WHERE id = ?
              `)
                .bind(id)
                .run();

              if (result.meta.changes === 0) {

                response = jsonError("Video not found", 404);

              } else {

                let storageCleanupPending = false;
                try {
                  await env.VIDEO_BUCKET.delete(video.r2Key);
                } catch (error) {
                  storageCleanupPending = true;
                  console.error("Failed to remove deleted video's R2 object:", error);
                }

                await recordAuditLog(
                  env,
                  accessUser!.id,
                  "video.deleted",
                  "video",
                  id,
                  { storageCleanupPending },
                );

                response = Response.json({
                  success: true,
                  deletedId: id,
                  storageCleanupPending,
                });

              }

            }

          }

        }

      } catch (error) {

        console.error("Failed to delete video:", error);

        response = jsonError("Failed to delete video", 500);

      }

    } else if (
      request.method === "GET" &&
      /^\/api\/stream\/videos\/[^/]+\/stream$/.test(url.pathname)
    ) {
      try {
        const id = decodeURIComponent(
          url.pathname.slice("/api/stream/videos/".length, -"/stream".length),
        );
        const video = await env.DB.prepare(`
          SELECT r2_key AS r2Key, content_type AS contentType
          FROM videos
          WHERE id = ?
        `)
          .bind(id)
          .first<{ r2Key: string; contentType: string }>();

        if (!video) {
          response = jsonError("Video not found", 404);
        } else {
          const rangeHeader = request.headers.get("Range");
          const object = await env.VIDEO_BUCKET.head(video.r2Key);

          if (!object) {
            response = jsonError("Video file not found", 404);
          } else if (rangeHeader && !/^bytes=\d*-\d*$/.test(rangeHeader.trim())) {
            response = new Response(null, {
              status: 416,
              headers: { "Content-Range": `bytes */${object.size}` },
            });
          } else {
            let start = 0;
            let end = object.size - 1;
            let range: { offset: number; length: number } | { suffix: number } | undefined;
            let rangeInvalid = false;

            if (rangeHeader) {
              const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
              const [, startText, endText] = match!;
              if (startText === "" && endText === "") {
                rangeInvalid = true;
                response = new Response(null, {
                  status: 416,
                  headers: { "Content-Range": `bytes */${object.size}` },
                });
              } else if (startText === "") {
                const suffix = Number(endText);
                if (!Number.isSafeInteger(suffix) || suffix <= 0) {
                  rangeInvalid = true;
                  response = new Response(null, {
                    status: 416,
                    headers: { "Content-Range": `bytes */${object.size}` },
                  });
                } else {
                  range = { suffix };
                  start = Math.max(0, object.size - suffix);
                }
              } else {
                start = Number(startText);
                end = endText === "" ? object.size - 1 : Number(endText);
                if (
                  !Number.isSafeInteger(start) ||
                  !Number.isSafeInteger(end) ||
                  start >= object.size ||
                  end < start
                ) {
                  rangeInvalid = true;
                  response = new Response(null, {
                    status: 416,
                    headers: { "Content-Range": `bytes */${object.size}` },
                  });
                } else {
                  end = Math.min(end, object.size - 1);
                  range = { offset: start, length: end - start + 1 };
                }
            }

            if (!rangeInvalid) {
              const body = await env.VIDEO_BUCKET.get(
                video.r2Key,
                range ? { range } : undefined,
              );
              if (!body || !("body" in body) || !body.body) {
                response = jsonError("Video file not found", 404);
              } else {
                const headers = new Headers({
                  "Content-Type": video.contentType,
                  "Accept-Ranges": "bytes",
                  "Content-Length": String(range ? end - start + 1 : object.size),
                });
                if (range) {
                  headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
                }
                response = new Response(body.body, {
                  status: range ? 206 : 200,
                  headers,
                });
              }
            }
          }
        }
        }
      } catch (error) {
        console.error("Failed to stream video:", error);
        response = jsonError("Failed to stream video", 500);
      }
    } else if (

      request.method === "GET" &&

      url.pathname === "/api/videos"

    ) {

      try {

        const result = await env.DB.prepare(`

          SELECT

            id,

            title,

            content_type AS contentType,

            size_bytes AS sizeBytes,

            created_at AS createdAt,

            uploaded_by AS uploadedBy,

            CASE WHEN EXISTS (
              SELECT 1 FROM schedules WHERE schedules.video_id = videos.id
            ) THEN 0 ELSE 1 END AS isUnused

          FROM videos

          ORDER BY created_at DESC

        `).all();

        response = Response.json({
          videos: result.results.map(({ uploadedBy, isUnused, ...video }) => ({
            ...video,
            canDelete: accessUser!.role === "admin" || uploadedBy === accessUser!.id,
            isUnused: Boolean(isUnused),
          })),
          canManageUsers: accessUser!.role === "admin",
        });

      } catch (error) {

        console.error("Failed to retrieve videos:", error);

        response = jsonError("Failed to retrieve videos", 500);

      }

    } else if (
      request.method === "POST" &&
      url.pathname === "/api/videos"
    ) {
      let uploadedKey: string | null = null;

      try {
        const requestContentType =
          request.headers.get("Content-Type") ?? "";

        if (
          !requestContentType
            .toLowerCase()
            .startsWith("multipart/form-data")
        ) {
          response = jsonError(
            "Content-Type must be multipart/form-data",
            400,
          );
        } else {
          const formData = await request.formData();
          const titleValue = formData.get("title");
          const fileValue = formData.get("file");

          if (
            typeof titleValue !== "string" ||
            titleValue.trim() === ""
          ) {
            response = jsonError("title is required", 400);
          } else if (!(fileValue instanceof File)) {
            response = jsonError("file is required", 400);
          } else if (fileValue.size === 0) {
            response = jsonError("file must not be empty", 400);
          } else if (!fileValue.type.startsWith("video/")) {
            response = jsonError(
              "Only video files are allowed",
              400,
            );
          } else if (fileValue.size > 100 * 1024 * 1024) {
            response = jsonError(
              "Video must be 100 MiB or smaller",
              413,
            );
          } else {
              const id = crypto.randomUUID();
              const r2Key = `videos/${id}`;
              const title = titleValue.trim();
              const contentType = fileValue.type;

              // Save the video file to R2.
              await env.VIDEO_BUCKET.put(
                r2Key,
                fileValue.stream(),
                {
                  httpMetadata: {
                    contentType,
                  },
                },
              );

              uploadedKey = r2Key;

              // Save video metadata to D1.
              await env.DB.prepare(`
                INSERT INTO videos (
                  id,
                  title,
                  r2_key,
                  content_type,
                  size_bytes,
                  uploaded_by
                )
                VALUES (?, ?, ?, ?, ?, ?)
              `)
                .bind(
                  id,
                  title,
                  r2Key,
                  contentType,
                  fileValue.size,
                  accessUser!.id,
                )
                .run();

              await recordAuditLog(env, accessUser!.id, "video.uploaded", "video", id, {
                title,
                contentType,
                sizeBytes: fileValue.size,
              });

              response = Response.json(
                {
                  video: {
                    id,
                    title,
                    contentType,
                    sizeBytes: fileValue.size,
                  },
                },
                { status: 201 },
              );

              // Upload and metadata insert succeeded; no cleanup needed.
              uploadedKey = null;
          }
        }
      } catch (error) {
        console.error("Failed to upload video:", error);
        response = jsonError("Failed to upload video", 500);
      } finally {
        // If D1 insert fails after R2 upload, remove the orphaned object.
        if (uploadedKey !== null) {
          try {
            await env.VIDEO_BUCKET.delete(uploadedKey);
          } catch (cleanupError) {
            console.error(
              "Failed to clean up uploaded video:",
              cleanupError,
            );
          }
        }
      }
    } else {
      response = jsonError("Not Found", 404);
    }

    return withCors(response, origin);
  },
};
