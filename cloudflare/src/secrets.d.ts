// Secrets aren't in wrangler.jsonc, so `wrangler types` only sees them when a
// local .dev.vars exists. Declare them here so typechecking works everywhere (CI).
interface Env {
  JWT_SECRET_KEY: string;
  ADMIN_TOKEN: string;
  FITBIT_CLIENT_ID: string;
  FITBIT_CLIENT_SECRET: string;
}
