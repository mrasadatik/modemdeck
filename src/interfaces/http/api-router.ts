export type ApiBody = Record<string, unknown>;
export type ApiResult = object | string | number | boolean | null;
/** Per-request context: the presenting session, if any. */
export interface ApiContext {
  sessionId?: string;
}
export type ApiHandler = (
  body: ApiBody,
  query?: URLSearchParams,
  ctx?: ApiContext,
) => Promise<ApiResult>;
export type ApiRoutes = Record<string, ApiHandler>;

/** Session cookie name shared by auth routes and the adapter. */
export const SESSION_COOKIE = 'modemdeck_sid';
/** Session envelope key: auth routes return it, the adapter turns it into a cookie. */
export const SESSION_ENVELOPE = '__session';
export interface SessionEnvelope {
  set?: string;
  clear?: boolean;
}

export function createApiRouter(routes: ApiRoutes) {
  return async (
    method: string,
    pathname: string,
    body: ApiBody,
    query = new URLSearchParams(),
    ctx?: ApiContext,
  ): Promise<ApiResult> => {
    const handler = routes[`${method} ${pathname}`];
    if (!handler) throw Object.assign(new Error('not found'), { statusCode: 404 });
    return handler(body, query, ctx);
  };
}
