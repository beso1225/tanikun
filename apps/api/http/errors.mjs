export class ApiError extends Error {
  constructor(code, { allow, cursor } = {}) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    if (allow !== undefined) this.allow = allow;
    if (cursor !== undefined) this.cursor = cursor;
  }
}

export function methodNotAllowed(allow) {
  return new ApiError("method_not_allowed", { allow });
}
