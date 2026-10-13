interface Env {
  VIDEO_API: {
    fetch(request: Request): Promise<Response>;
  };
}

interface PagesFunctionContext {
  request: Request;
  env: Env;
}

export async function onRequest({ request, env }: PagesFunctionContext): Promise<Response> {
  if (!env.VIDEO_API) {
    return Response.json({ error: "Video API service is not connected" }, { status: 503 });
  }

  // Forward the original request so Access's Cf-Access-Jwt-Assertion header,
  // HTTP Range headers, query parameters, and upload body reach the API Worker.
  return env.VIDEO_API.fetch(request);
}
