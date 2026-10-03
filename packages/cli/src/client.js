// Calls to the Jump API with a developer token.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.code;
    this.details = body?.details;
  }
}

export function client({ apiUrl, token }) {
  return async function call(method, path, body) {
    let res;
    try {
      res = await fetch(`${apiUrl}${path}`, {
        method,
        headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`Could not reach ${apiUrl} (${error.cause?.code || error.message})`);
    }
    if (res.status === 204) return null;
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401 && token) throw new ApiError(401, { ...json, message: `${json?.message || 'Signed out'} Run \`jump login\` again.` });
      throw new ApiError(res.status, json);
    }
    return json;
  };
}
