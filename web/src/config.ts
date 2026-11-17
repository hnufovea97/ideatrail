/** API origin, fixed at build time (PUBLIC_API_BASE). The CSP connect-src is built from the same value. */
export const API_BASE: string = import.meta.env.PUBLIC_API_BASE ?? "http://localhost:8787";
