/**
 * Static exports (NEXT_OUTPUT=export, used for Cloudflare) prerender one
 * placeholder page per dynamic route, and the Worker serves it for any id.
 * The page then receives this placeholder as its param.
 */
export const STATIC_PARAM_PLACEHOLDER = '_';
