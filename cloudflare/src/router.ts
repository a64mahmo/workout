import type { Db, Row } from "./db";

export interface Ctx {
  db: Db;
  userId: string;
  query: Record<string, string>;
  body: unknown;
  env: Env;
}

export type Handler = (c: Ctx, params: Record<string, string>) => unknown | Promise<unknown>;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

/** First match wins, in registration order (same as FastAPI). */
export class Router {
  private routes: Route[] = [];

  on(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
    return this;
  }
  get = (p: string, h: Handler) => this.on("GET", p, h);
  post = (p: string, h: Handler) => this.on("POST", p, h);
  put = (p: string, h: Handler) => this.on("PUT", p, h);
  patch = (p: string, h: Handler) => this.on("PATCH", p, h);
  delete = (p: string, h: Handler) => this.on("DELETE", p, h);

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | "method" | null {
    const segs = path.split("/").filter(Boolean);
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const p = r.parts[i];
        if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(segs[i]);
        else if (p !== segs[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (r.method !== method) {
        pathMatched = true;
        continue;
      }
      return { handler: r.handler, params };
    }
    return pathMatched ? "method" : null;
  }
}

export type { Row };
