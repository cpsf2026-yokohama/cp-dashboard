interface Env {

  DB: D1Database;

  VIDEO_BUCKET: R2Bucket;

  ACCESS_TEAM_DOMAIN?: string;

  ACCESS_AUD?: string;

  LOCAL_AUTH_BYPASS?: string;

  LOCAL_AUTH_BYPASS_ROLE?: string;

}

const allowedOrigin = "http://localhost:3000";

const localAdminId = "local-test-admin";
const bannerKinds = ["horizontal", "vertical"] as const;
type BannerKind = (typeof bannerKinds)[number];
const maxBannerBytes = 10 * 1024 * 1024;

function bannerKindFromPath(pathname: string): BannerKind | null {
  const match = /^\/api\/banners\/(horizontal|vertical)$/.exec(pathname);
  return (match?.[1] as BannerKind | undefined) ?? null;
}

const sharedSettingKeys = [
  "countdownDates",
  "yearlyCountdownDates",
  "userChimeTimes",
  "isChimeEnabled",
  "isPreChimeEnabled",
  "isBannerVisible",
  "isVerticalBanner",
] as const;

type SharedSettingsApply = Record<(typeof sharedSettingKeys)[number], boolean>;

const defaultSharedSettingsApply: SharedSettingsApply = {
  countdownDates: true,
  yearlyCountdownDates: true,
  userChimeTimes: true,
  isChimeEnabled: true,
  isPreChimeEnabled: true,
  isBannerVisible: true,
  isVerticalBanner: true,
};

function parseSharedSettingsApply(value: unknown): SharedSettingsApply | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!sharedSettingKeys.every((key) => typeof record[key] === "boolean")) {
    return null;
  }
  return Object.fromEntries(
    sharedSettingKeys.map((key) => [key, record[key]]),
  ) as SharedSettingsApply;
}

type UserRole = "admin" | "producer" | "operator" | "mentor";

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
    (method === "GET" && pathname === "/api/change-requests") ||
    (method === "POST" && /^\/api\/change-requests\/[^/]+\/(approve|reject)$/.test(pathname)) ||
    (method === "PUT" && pathname === "/api/settings") ||
    ((method === "PUT" || method === "DELETE") && /^\/api\/banners\/(horizontal|vertical)$/.test(pathname)) ||
    (method === "GET" &&
      ["/api/schedules", "/api/videos", "/api/users"].includes(pathname)) ||
    (method === "POST" && ["/api/schedules", "/api/videos", "/api/users"].includes(pathname)) ||
    (method === "DELETE" && pathname.startsWith("/api/schedules/") && pathname !== "/api/schedules/") ||
    (method === "DELETE" && /^\/api\/videos\/[^/]+$/.test(pathname)) ||
    (method === "PATCH" && /^\/api\/users\/[^/]+$/.test(pathname))
  );
}

export function hasRoleForRoute(user: Pick<ApiUser, "role">, method: string, pathname: string): boolean {
  if (method === "GET" && pathname === "/api/change-requests") return user.role === "mentor";
  if (method === "POST" && /^\/api\/change-requests\/[^/]+\/(approve|reject)$/.test(pathname)) return user.role === "mentor";
  if (
    (method === "PUT" && pathname === "/api/settings") ||
    ((method === "PUT" || method === "DELETE") && /^\/api\/banners\/(horizontal|vertical)$/.test(pathname)) ||
    (method === "GET" && pathname === "/api/users") ||
    (method === "POST" && pathname === "/api/users") ||
    (method === "PATCH" && /^\/api\/users\/[^/]+$/.test(pathname))
  ) {
    return user.role === "admin" || user.role === "mentor";
  }

  if (method === "POST" && pathname === "/api/videos") {
    return user.role === "admin" || user.role === "mentor" || user.role === "producer";
  }

  if (
    (method === "POST" && pathname === "/api/schedules") ||
    (method === "DELETE" && pathname.startsWith("/api/schedules/"))
  ) {
    return user.role === "admin" || user.role === "mentor" || user.role === "operator";
  }

  if (method === "DELETE" && /^\/api\/videos\/[^/]+$/.test(pathname)) {
    return user.role === "admin" || user.role === "mentor" || user.role === "producer";
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
    const localRole = env.LOCAL_AUTH_BYPASS_ROLE === "mentor" ? "mentor" : "admin";
    const localAdmin = await env.DB.prepare(`
      SELECT id, email, role
      FROM users
      WHERE id = ? AND role = '${localRole}'
    `)
      .bind(localAdminId)
      .first<{ id: string; email: string; role: string }>();

    if (!localAdmin) {
      return { user: null, response: jsonError("Local test admin not found", 403) };
    }

    return {
      user: { id: localAdmin.id, email: localAdmin.email, role: localRole },
      response: null,
    };
  }

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return {
      user: null,
      response: jsonError("Access authentication is not configured", 503),
    };
  }

  // Access adds the assertion header when the request path is covered by an
  // Access application. For browser routes intentionally left outside Access
  // (public GET /api/settings paired with admin-only PUT), the same signed
  // token is also sent in CF_Authorization. Verify it like the assertion;
  // never trust the cookie without JWT validation.
  const token = request.headers.get("cf-access-jwt-assertion") ??
    request.headers.get("cookie")
      ?.split(";")
      .map(part => part.trim())
      .find(part => part.startsWith("CF_Authorization="))
      ?.slice("CF_Authorization=".length) ??
    null;
  if (!token) {
    return {
      user: null,
      response: jsonError("Access authentication required", 401),
    };
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

    if (!user || !["admin", "producer", "operator", "mentor"].includes(user.role)) {
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

    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");

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
  return value === "admin" || value === "producer" || value === "operator" || value === "mentor";
}

function isDashboardMutation(method: string, pathname: string): boolean {
  return (method === "PUT" && pathname === "/api/settings") ||
    ((method === "PUT" || method === "DELETE") && /^\/api\/banners\/(horizontal|vertical)$/.test(pathname)) ||
    (method === "POST" && pathname === "/api/schedules") ||
    (method === "DELETE" && (/^\/api\/schedules\/[^/]+$/.test(pathname) || /^\/api\/videos\/[^/]+$/.test(pathname)));
}

async function createChangeRequest(env: Env, requester: string, kind: string, payload: Record<string, unknown>, summary: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO change_requests (id, requester_id, kind, summary, payload_json) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, requester, kind, summary, JSON.stringify(payload)).run();
  return id;
}

async function applyChangeRequest(env: Env, reviewer: string, row: { id: string; requesterId: string; kind: string; payloadJson: string }): Promise<void> {
  const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
  switch (row.kind) {
    case "settings": {
      const current = await env.DB.prepare("SELECT settings_json AS settingsJson, apply_json AS applyJson FROM shared_settings WHERE id = 1")
        .first<{ settingsJson: string; applyJson: string }>();
      if (!current) throw new Error("Shared settings not found");
      const settings = JSON.parse(current.settingsJson) as Record<string, unknown>;
      const incoming = payload.settings as Record<string, unknown>;
      const apply = payload.apply as SharedSettingsApply | undefined;
      let currentApply = defaultSharedSettingsApply;
      try { currentApply = parseSharedSettingsApply(JSON.parse(current.applyJson)) ?? defaultSharedSettingsApply; } catch { /* use defaults */ }
      const effectiveApply = apply ?? currentApply;
      for (const key of sharedSettingKeys) if ((payload.adminEdit === true || effectiveApply[key]) && key in incoming) settings[key] = incoming[key];
      await env.DB.prepare("UPDATE shared_settings SET settings_json = ?, apply_json = ?, updated_at = datetime('now') WHERE id = 1")
        .bind(JSON.stringify(settings), JSON.stringify(apply ?? parseSharedSettingsApply(JSON.parse(current.applyJson)) ?? defaultSharedSettingsApply)).run();
      break;
    }
    case "schedule.create": {
      const videoId = String(payload.videoId); const startsAt = String(payload.startsAt);
      const video = await env.DB.prepare("SELECT id FROM videos WHERE id = ?").bind(videoId).first();
      if (!video) throw new Error("Video no longer exists");
      await env.DB.prepare("INSERT INTO schedules (id, video_id, starts_at, created_by) VALUES (?, ?, ?, ?)")
        .bind(String(payload.id), videoId, startsAt, row.requesterId).run();
      break;
    }
    case "schedule.delete": {
      await env.DB.prepare("DELETE FROM schedules WHERE id = ?").bind(String(payload.id)).run(); break;
    }
    case "video.upload": {
      const id = String(payload.id), stagingKey = String(payload.stagingKey), r2Key = `videos/${id}`;
      const staged = await env.VIDEO_BUCKET.get(stagingKey);
      if (!staged) throw new Error("Staged video file is missing");
      await env.VIDEO_BUCKET.put(r2Key, staged.body, { httpMetadata: { contentType: String(payload.contentType) } });
      await env.DB.prepare("INSERT INTO videos (id, title, r2_key, content_type, size_bytes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, String(payload.title), r2Key, String(payload.contentType), Number(payload.sizeBytes), row.requesterId).run();
      await env.VIDEO_BUCKET.delete(stagingKey); break;
    }
    case "video.delete": {
      const id = String(payload.id);
      const active = await env.DB.prepare("SELECT id FROM schedules WHERE video_id = ? LIMIT 1").bind(id).first();
      if (active) throw new Error("Remove this video's schedules before deleting it");
      const video = await env.DB.prepare("SELECT r2_key AS r2Key FROM videos WHERE id = ?").bind(id).first<{ r2Key: string }>();
      if (!video) throw new Error("Video no longer exists");
      await env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(id).run(); await env.VIDEO_BUCKET.delete(video.r2Key); break;
    }
    case "banner.upload": {
      const staged = await env.VIDEO_BUCKET.get(String(payload.stagingKey));
      if (!staged) throw new Error("Staged banner file is missing");
      await env.VIDEO_BUCKET.put(`banners/${String(payload.kind)}`, staged.body, { httpMetadata: { contentType: String(payload.contentType) } });
      await env.VIDEO_BUCKET.delete(String(payload.stagingKey)); break;
    }
    case "banner.delete": await env.VIDEO_BUCKET.delete(`banners/${String(payload.kind)}`); break;
    default: throw new Error("Unsupported change request");
  }
  await recordAuditLog(env, reviewer, "change.approved", "change_request", row.id, { kind: row.kind });
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

    } else if (request.method === "GET" && url.pathname === "/api/change-requests") {
      const result = await env.DB.prepare(`SELECT cr.id, cr.kind, cr.summary, cr.payload_json AS payloadJson, cr.requester_id AS requesterId, u.email AS requesterEmail, cr.created_at AS createdAt FROM change_requests cr JOIN users u ON u.id = cr.requester_id WHERE cr.status = 'pending' ORDER BY cr.created_at ASC`).all();
      const settingsRow = await env.DB.prepare("SELECT settings_json AS settingsJson, apply_json AS applyJson FROM shared_settings WHERE id = 1")
        .first<{ settingsJson: string; applyJson: string }>();
      const currentSettings = settingsRow ? JSON.parse(settingsRow.settingsJson) as Record<string, unknown> : {};
      let currentApply = defaultSharedSettingsApply;
      try { if (settingsRow) currentApply = parseSharedSettingsApply(JSON.parse(settingsRow.applyJson)) ?? defaultSharedSettingsApply; } catch { /* use defaults */ }
      const labels: Record<string, string> = { countdownDates: "カウントダウン予定", yearlyCountdownDates: "毎年の予定", userChimeTimes: "チャイム時刻", isChimeEnabled: "チャイム", isPreChimeEnabled: "予鈴", isBannerVisible: "横バナー", isVerticalBanner: "縦バナー" };
      const valueText = (value: unknown) => typeof value === "boolean" ? (value ? "有効" : "無効") : Array.isArray(value) ? `${value.length}件` : value === undefined ? "未設定" : "変更あり";
      response = Response.json({ requests: result.results.map((row) => {
        const payload = JSON.parse(String(row.payloadJson)) as Record<string, unknown>;
        let summary = String(row.summary);
        if (row.kind === "settings" && !payload.changes) {
          const requested = (payload.settings ?? {}) as Record<string, unknown>;
          const changes: Record<string, { before: unknown; after: unknown }> = {};
          const applyChanges: Record<string, { before: boolean; after: boolean }> = {};
          for (const key of sharedSettingKeys) {
            if (key in requested && JSON.stringify(currentSettings[key]) !== JSON.stringify(requested[key])) changes[key] = { before: currentSettings[key], after: requested[key] };
          }
          const requestedApply = (payload.apply as SharedSettingsApply | undefined) ?? currentApply;
          for (const key of sharedSettingKeys) if (requestedApply[key] !== currentApply[key]) applyChanges[key] = { before: currentApply[key], after: requestedApply[key] };
          payload.changes = changes;
          payload.applyChanges = applyChanges;
          const descriptions = Object.entries(changes).map(([key, value]) => `${labels[key]}: ${valueText(value.before)} → ${valueText(value.after)}`);
          for (const [key, value] of Object.entries(applyChanges)) descriptions.push(`${labels[key]}のサイト反映: ${value.before ? "有効" : "無効"} → ${value.after ? "有効" : "無効"}`);
          if (descriptions.length) summary = descriptions.join("・");
        }
        return { ...row, summary, payloadJson: undefined, payload };
      }) });
    } else if (request.method === "POST" && /^\/api\/change-requests\/[^/]+\/(approve|reject)$/.test(url.pathname)) {
      const [, idPart, decision] = /^\/api\/change-requests\/([^/]+)\/(approve|reject)$/.exec(url.pathname)!;
      const id = decodeURIComponent(idPart);
      const row = await env.DB.prepare("SELECT id, requester_id AS requesterId, kind, payload_json AS payloadJson, status FROM change_requests WHERE id = ?").bind(id)
        .first<{ id: string; requesterId: string; kind: string; payloadJson: string; status: string }>();
      if (!row || row.status !== "pending") response = jsonError("Request not found or already reviewed", 404);
      else if (decision === "approve" && row.requesterId === accessUser!.id) response = jsonError("Mentors cannot approve their own requests", 409);
      else {
        try {
          const claim = await env.DB.prepare("UPDATE change_requests SET status = 'processing' WHERE id = ? AND status = 'pending'").bind(id).run();
          if (claim.meta.changes === 0) throw new Error("Request is already being reviewed");
          try {
            if (decision === "approve") await applyChangeRequest(env, accessUser!.id, row);
            else {
              const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
              if (typeof payload.stagingKey === "string") await env.VIDEO_BUCKET.delete(payload.stagingKey);
            }
          } catch (error) {
            await env.DB.prepare("UPDATE change_requests SET status = 'pending' WHERE id = ? AND status = 'processing'").bind(id).run().catch(() => undefined);
            throw error;
          }
          await env.DB.prepare("UPDATE change_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ? AND status = 'processing'")
            .bind(decision === "approve" ? "approved" : "rejected", accessUser!.id, id).run();
          response = Response.json({ success: true, status: decision === "approve" ? "approved" : "rejected" });
        } catch (error) {
          console.error("Failed to review change request:", error);
          response = jsonError(error instanceof Error ? error.message : "Failed to apply request", 409);
        }
      }
    } else if (isDashboardMutation(request.method, url.pathname)) {
      let stagingKeyToCleanup: string | null = null;
      try {
        let kind = "", summary = "", payload: Record<string, unknown> = {};
        const bannerKind = bannerKindFromPath(url.pathname);
        if (request.method === "PUT" && url.pathname === "/api/settings") {
          const body = await request.json() as Record<string, unknown>;
          if (!body || (!body.settings && !body.apply)) throw new Error("settings or apply is required");
          if (body.settings !== undefined && (typeof body.settings !== "object" || body.settings === null || Array.isArray(body.settings))) throw new Error("settings must be an object");
          if (body.apply !== undefined && !parseSharedSettingsApply(body.apply)) throw new Error("Invalid apply settings");
          kind = "settings";
          const labels: Record<string, string> = {
            countdownDates: "カウントダウン予定", yearlyCountdownDates: "毎年の予定", userChimeTimes: "チャイム時刻",
            isChimeEnabled: "チャイム", isPreChimeEnabled: "予鈴", isBannerVisible: "横バナー", isVerticalBanner: "縦バナー",
          };
          const settings = (body.settings ?? {}) as Record<string, unknown>;
          const stored = await env.DB.prepare("SELECT settings_json AS settingsJson, apply_json AS applyJson FROM shared_settings WHERE id = 1")
            .first<{ settingsJson: string; applyJson: string }>();
          if (!stored) throw new Error("Shared settings not found");
          const beforeSettings = JSON.parse(stored.settingsJson) as Record<string, unknown>;
          let beforeApply = defaultSharedSettingsApply;
          try { beforeApply = parseSharedSettingsApply(JSON.parse(stored.applyJson)) ?? defaultSharedSettingsApply; } catch { /* use defaults */ }
          const afterApply = (body.apply as SharedSettingsApply | undefined) ?? beforeApply;
          const changes: Record<string, { before: unknown; after: unknown }> = {};
          const applyChanges: Record<string, { before: boolean; after: boolean }> = {};
          for (const key of sharedSettingKeys) {
            if (key in settings && JSON.stringify(beforeSettings[key]) !== JSON.stringify(settings[key])) changes[key] = { before: beforeSettings[key], after: settings[key] };
            if (afterApply[key] !== beforeApply[key]) applyChanges[key] = { before: beforeApply[key], after: afterApply[key] };
          }
          const describeValue = (key: string, value: unknown) => {
            if (typeof value === "boolean") return value ? "有効" : "無効";
            if (Array.isArray(value)) return `${value.length}件`;
            return value === undefined ? "未設定" : "変更あり";
          };
          const descriptions = Object.entries(changes).map(([key, change]) => `${labels[key] ?? key}: ${describeValue(key, change.before)} → ${describeValue(key, change.after)}`);
          for (const [key, change] of Object.entries(applyChanges)) descriptions.push(`${labels[key]}のサイト反映: ${change.before ? "有効" : "無効"} → ${change.after ? "有効" : "無効"}`);
          summary = descriptions.length ? descriptions.join("・") : "共有設定を変更";
          payload = { settings, apply: body.apply, changes, applyChanges, adminEdit: body.adminEdit === true };
        } else if (bannerKind && request.method === "DELETE") {
          kind = "banner.delete"; summary = `${bannerKind === "horizontal" ? "横" : "縦"}型バナーを削除`; payload = { kind: bannerKind };
        } else if (bannerKind && request.method === "PUT") {
          const contentType = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() ?? "";
          const bytes = await request.arrayBuffer();
          if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(contentType) || bytes.byteLength < 1 || bytes.byteLength > maxBannerBytes) throw new Error("PNG/JPEG/WebP/GIF/AVIF画像（10 MiB以下）を指定してください");
          const stagingKey = `pending/${crypto.randomUUID()}`;
          stagingKeyToCleanup = stagingKey;
          await env.VIDEO_BUCKET.put(stagingKey, bytes, { httpMetadata: { contentType } });
          kind = "banner.upload"; summary = `${bannerKind === "horizontal" ? "横" : "縦"}型バナーを更新`; payload = { kind: bannerKind, stagingKey, contentType };
        } else if (request.method === "POST" && url.pathname === "/api/schedules") {
          const body = await request.json() as Record<string, unknown>;
          const startsAt = new Date(String(body.startsAt));
          if (typeof body.videoId !== "string" || Number.isNaN(startsAt.getTime())) throw new Error("videoId and valid startsAt are required");
          const video = await env.DB.prepare("SELECT id, title FROM videos WHERE id = ?").bind(body.videoId).first<{ id: string; title?: string }>();
          if (!video) throw new Error("Video not found");
          kind = "schedule.create"; summary = `予定を追加: ${video.title ?? "動画"}`; payload = { videoId: body.videoId, videoTitle: video.title, startsAt: startsAt.toISOString(), id: crypto.randomUUID() };
        } else if (request.method === "DELETE" && /^\/api\/schedules\/[^/]+$/.test(url.pathname)) {
          const id = decodeURIComponent(url.pathname.slice("/api/schedules/".length));
          const schedule = await env.DB.prepare("SELECT videos.title AS title, schedules.starts_at AS startsAt FROM schedules JOIN videos ON videos.id = schedules.video_id WHERE schedules.id = ?").bind(id).first<{ title?: string; startsAt?: string }>();
          kind = "schedule.delete"; summary = `予定を削除: ${schedule?.title ?? "動画"}`; payload = { id, videoTitle: schedule?.title, startsAt: schedule?.startsAt };
        } else if (request.method === "DELETE" && /^\/api\/videos\/[^/]+$/.test(url.pathname)) {
          const id = decodeURIComponent(url.pathname.slice("/api/videos/".length));
          const video = await env.DB.prepare("SELECT r2_key AS r2Key, uploaded_by AS uploadedBy, title FROM videos WHERE id = ?").bind(id).first<{ r2Key: string; uploadedBy: string; title?: string }>();
          if (!video) throw new Error("Video not found");
          if (accessUser!.role !== "admin" && accessUser!.role !== "mentor" && video.uploadedBy !== accessUser!.id) throw new Error("You can only delete videos you uploaded");
          const scheduled = await env.DB.prepare("SELECT id FROM schedules WHERE video_id = ? LIMIT 1").bind(id).first();
          if (scheduled) throw new Error("Remove this video's schedules before deleting it");
          kind = "video.delete"; summary = `動画を削除: ${video.title ?? "動画"}`; payload = { id, title: video.title };
        } else if (request.method === "POST" && url.pathname === "/api/videos") {
          const form = await request.formData(); const file = form.get("file"); const title = form.get("title");
          if (!(file instanceof File) || typeof title !== "string" || !title.trim() || file.size < 1 || file.size > 100 * 1024 * 1024 || !file.type.startsWith("video/")) throw new Error("動画名と100 MiB以下の動画ファイルが必要です");
          const id = crypto.randomUUID(), stagingKey = `pending/${id}`;
          stagingKeyToCleanup = stagingKey;
          await env.VIDEO_BUCKET.put(stagingKey, file.stream(), { httpMetadata: { contentType: file.type } });
          kind = "video.upload"; summary = `動画を追加: ${title.trim()}`; payload = { id, stagingKey, title: title.trim(), contentType: file.type, sizeBytes: file.size };
        }
        const id = await createChangeRequest(env, accessUser!.id, kind, payload, summary);
        response = Response.json({ success: true, requestId: id, status: "pending", message: "メンターの承認待ちです" }, { status: 202 });
      } catch (error) {
        if (stagingKeyToCleanup) await env.VIDEO_BUCKET.delete(stagingKeyToCleanup).catch(() => undefined);
        response = jsonError(error instanceof Error ? error.message : "Invalid change request", 400);
      }


    } else if (request.method === "GET" && url.pathname === "/api/banners") {
      try {
        const banners = await Promise.all(bannerKinds.map(async (kind) => {
          const object = await env.VIDEO_BUCKET.head(`banners/${kind}`);
          return [kind, object ? {
            etag: object.httpEtag,
            size: object.size,
            contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
          } : null] as const;
        }));
        response = Response.json({ banners: Object.fromEntries(banners) });
      } catch (error) {
        console.error("Failed to retrieve banners:", error);
        response = jsonError("Failed to retrieve banners", 500);
      }
    } else if (request.method === "GET" && bannerKindFromPath(url.pathname)) {
      try {
        const kind = bannerKindFromPath(url.pathname)!;
        const object = await env.VIDEO_BUCKET.get(`banners/${kind}`);
        if (!object) {
          response = jsonError("Banner not found", 404);
        } else {
          const headers = new Headers({
            "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
            "Cache-Control": "public, max-age=0, must-revalidate",
            "ETag": object.httpEtag,
            "X-Content-Type-Options": "nosniff",
          });
          if (request.headers.get("If-None-Match") === object.httpEtag) {
            response = new Response(null, { status: 304, headers });
          } else {
            response = new Response(object.body, { headers });
          }
        }
      } catch (error) {
        console.error("Failed to retrieve banner:", error);
        response = jsonError("Failed to retrieve banner", 500);
      }
    } else if ((request.method === "PUT" || request.method === "DELETE") && bannerKindFromPath(url.pathname)) {
      const kind = bannerKindFromPath(url.pathname)!;
      const key = `banners/${kind}`;
      if (request.method === "DELETE") {
        try {
          await env.VIDEO_BUCKET.delete(key);
          response = Response.json({ success: true });
        } catch (error) {
          console.error("Failed to delete banner:", error);
          response = jsonError("Failed to delete banner", 500);
        }
      } else {
        const contentType = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() ?? "";
        const contentLength = Number(request.headers.get("Content-Length") ?? 0);
        if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(contentType)) {
          response = jsonError("Only PNG, JPEG, WebP, GIF, and AVIF images are allowed", 415);
        } else if (contentLength > maxBannerBytes) {
          response = jsonError("Banner image must be 10 MiB or smaller", 413);
        } else {
          try {
            const bytes = await request.arrayBuffer();
            if (bytes.byteLength === 0 || bytes.byteLength > maxBannerBytes) {
              response = jsonError("Banner image must be between 1 byte and 10 MiB", 413);
            } else {
              await env.VIDEO_BUCKET.put(key, bytes, { httpMetadata: { contentType } });
              response = Response.json({ success: true });
            }
          } catch (error) {
            console.error("Failed to save banner:", error);
            response = jsonError("Failed to save banner", 500);
          }
        }
      }
    } else if (
      request.method === "GET" &&
      url.pathname === "/api/settings"
    ) {
      try {
        const row = await env.DB.prepare(`
          SELECT settings_json AS settingsJson, apply_json AS applyJson, updated_at AS updatedAt
          FROM shared_settings
          WHERE id = 1
        `).first<{ settingsJson: string; applyJson: string; updatedAt: string }>();

        if (!row) {
          response = jsonError("Shared settings not found", 404);
        } else {
          try {
            const settings: unknown = JSON.parse(row.settingsJson);
            let apply = defaultSharedSettingsApply;
            try {
              apply = parseSharedSettingsApply(JSON.parse(row.applyJson)) ?? defaultSharedSettingsApply;
            } catch {
              apply = defaultSharedSettingsApply;
            }
            response = Response.json({
              settings,
              apply,
              updatedAt: row.updatedAt,
            });
          } catch {
            response = jsonError("Stored settings are invalid", 500);
          }
        }
      } catch (error) {
        console.error("Failed to retrieve shared settings:", error);
        response = jsonError("Failed to retrieve shared settings", 500);
      }
    } else if (
      request.method === "PUT" &&
      url.pathname === "/api/settings"
    ) {
      try {
        const body: unknown = await request.json();

        if (
          typeof body !== "object" ||
          body === null ||
          Array.isArray(body) ||
          (!("settings" in body) && !("apply" in body))
        ) {
          response = jsonError("settings or apply is required", 400);
        } else {
          const input = body as { settings?: unknown; apply?: unknown; adminEdit?: unknown };
          const nextApply = input.apply === undefined
            ? null
            : parseSharedSettingsApply(input.apply);

          if (input.apply !== undefined && !nextApply) {
            response = jsonError("apply must contain a boolean for each setting", 400);
          } else {
            const current = await env.DB.prepare(`
              SELECT settings_json AS settingsJson, apply_json AS applyJson
              FROM shared_settings
              WHERE id = 1
            `).first<{ settingsJson: string; applyJson: string }>();

            if (!current) {
              response = jsonError("Shared settings not found", 404);
            } else {
              try {
                const storedSettings: unknown = JSON.parse(current.settingsJson);
                const nextSettings: Record<string, unknown> = typeof storedSettings === "object" && storedSettings !== null
                  ? { ...(storedSettings as Record<string, unknown>) }
                  : {};
                let storedApply = defaultSharedSettingsApply;
                try {
                  storedApply = parseSharedSettingsApply(JSON.parse(current.applyJson)) ?? defaultSharedSettingsApply;
                } catch {
                  storedApply = defaultSharedSettingsApply;
                }
                const effectiveApply = nextApply ?? storedApply;
                let invalidSettings = false;

                if (input.settings !== undefined) {
                  if (typeof input.settings !== "object" || input.settings === null || Array.isArray(input.settings)) {
                    response = jsonError("settings must be an object", 400);
                    invalidSettings = true;
                  } else {
                    const incoming = input.settings as Record<string, unknown>;
                    for (const key of sharedSettingKeys) {
                      if ((input.adminEdit === true || effectiveApply[key]) && key in incoming) {
                        nextSettings[key] = incoming[key];
                      }
                    }
                  }
                }

                if (!invalidSettings) {
                  const settingsJson = JSON.stringify(nextSettings);
                  const applyJson = JSON.stringify(effectiveApply);
                  if (settingsJson.length > 100_000) {
                    response = jsonError("Settings are too large", 400);
                  } else {
                    await env.DB.prepare(`
                      UPDATE shared_settings
                      SET settings_json = ?, apply_json = ?, updated_at = datetime('now')
                      WHERE id = 1
                    `)
                      .bind(settingsJson, applyJson)
                      .run();
                    response = Response.json({ success: true });
                  }
                }
              } catch (error) {
                console.error("Failed to parse shared settings:", error);
                response = jsonError("Stored settings are invalid", 500);
              }
            }
          }
        }
      } catch (error) {
        console.error("Failed to update shared settings:", error);
        response = jsonError("Failed to update shared settings", 500);
      }

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
          } else if (user.id === accessUser!.id && body.role !== "admin" && body.role !== "mentor") {
            response = jsonError("You cannot remove your own administrator privileges", 409);
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

        // Return a short preparation window so clients can warm the selected
        // video's media buffer before the scheduled start time.
        const windowEnd = new Date(now.getTime() + 5 * 60_000).toISOString();

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

          } else if (accessUser!.role !== "admin" && accessUser!.role !== "mentor" && video.uploadedBy !== accessUser!.id) {

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
            canDelete: accessUser!.role === "admin" || accessUser!.role === "mentor" || uploadedBy === accessUser!.id,
            isUnused: Boolean(isUnused),
          })),
          canManageUsers: accessUser!.role === "admin" || accessUser!.role === "mentor",
          canReviewRequests: accessUser!.role === "mentor",
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
