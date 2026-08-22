export interface Env {
  ASSETS: Fetcher
  SOLFV_ENGINE: DurableObjectNamespace<SolfvEngine>
  /**
   * Public HTTPS base URL for the separately hosted Python engine.
   * Keep the frontend on the same origin and proxy /api/* through this Worker.
   */
  ENGINE_ORIGIN?: string
}

/**
 * Retained solely to preserve the Durable Object namespace created by the
 * earlier container deployment attempt. It is never called by the free-tier
 * proxy and can be removed later only through an explicit destructive
 * migration.
 */
export class SolfvEngine {
  async fetch(): Promise<Response> {
    return new Response('The retired SOLFV engine is not available here.', { status: 410 })
  }
}

function engineUnavailable(): Response {
  return Response.json(
    {
      detail:
        'The SOLFV engine has not been connected yet. Configure ENGINE_ORIGIN on this Worker.',
    },
    { status: 503 },
  )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      if (!env.ENGINE_ORIGIN) return engineUnavailable()

      const origin = new URL(env.ENGINE_ORIGIN)
      origin.pathname = url.pathname.slice(4) || '/'
      origin.search = url.search
      return fetch(new Request(origin, request))
    }

    return env.ASSETS.fetch(request)
  },
}
