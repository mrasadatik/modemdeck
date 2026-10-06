export type ApiBody = Record<string, unknown>;
export type ApiResult = object | string | number | boolean | null;
export type ApiHandler = (body: ApiBody, query: URLSearchParams) => Promise<ApiResult>;
export type ApiRoutes = Record<string, ApiHandler>;

export function createApiRouter(routes: ApiRoutes) {
  return async (
    method: string,
    pathname: string,
    body: ApiBody,
    query = new URLSearchParams(),
  ): Promise<ApiResult> => {
    const handler = routes[`${method} ${pathname}`];
    if (!handler) throw Object.assign(new Error('not found'), { statusCode: 404 });
    return handler(body, query);
  };
}
