import { z } from "zod";

/** Serializable request passed from the Worker to a Durable Object over RPC. */
export interface ApiRequest {
  method: string;
  /** Path without the /api prefix and without a trailing slash, e.g. "/sessions/abc". */
  path: string;
  query: Record<string, string>;
  body: unknown;
}

export interface ApiResponse {
  status: number;
  /** Pre-serialized JSON: a string crosses RPC far cheaper than an object graph. */
  body: string;
}

/** Mirrors FastAPI's HTTPException: serialized as {"detail": ...}. */
export class HttpError extends Error {
  constructor(public status: number, public detail: unknown) {
    super(typeof detail === "string" ? detail : "HTTP error");
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);

/** Parse with zod, turning failures into FastAPI-style 422s. */
export function parse<T extends z.ZodType>(schema: T, data: unknown, loc = "body"): z.infer<T> {
  const r = schema.safeParse(data ?? (loc === "body" ? undefined : {}));
  if (!r.success) {
    throw new HttpError(
      422,
      r.error.issues.map((i) => ({ loc: [loc, ...i.path], msg: i.message, type: i.code })),
    );
  }
  return r.data;
}

// ── pydantic-like lax scalars ────────────────────────────────────────────────
const numericString = z
  .string()
  .regex(/^\s*-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/)
  .transform(Number);
export const num = z.union([z.number(), numericString]).pipe(z.number().finite());
export const int = num.pipe(z.number().int());
export const bool = z.union([
  z.boolean(),
  z.literal(0).transform(() => false),
  z.literal(1).transform(() => true),
  z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1"),
]);
export const str = z.string();
export const opt = <T extends z.ZodType>(t: T) => t.nullable().optional();

// ── Python-compatible numerics/formatting ────────────────────────────────────
/** Python's round(): half-to-even, optional ndigits. */
export function pyRound(x: number, ndigits = 0): number {
  if (!Number.isFinite(x)) return x;
  // Like CPython, round the *exact* binary value (e.g. 317.85 is really
  // 317.8500000000000227, so it rounds up). toFixed() rounds the exact value
  // correctly except on true ties, where it goes away from zero; Python goes to even.
  const exact = Math.abs(x).toFixed(Math.min(ndigits + 25, 100));
  const dot = exact.indexOf(".");
  const rest = exact.slice(dot + 1 + ndigits);
  if (rest !== "5" + "0".repeat(rest.length - 1)) return Number(x.toFixed(ndigits));
  const kept = exact.slice(0, dot + 1 + ndigits).replace(/\.$/, "");
  const lastDigit = Number(kept.replace(".", "").slice(-1));
  const step = 10 ** -ndigits;
  const mag = lastDigit % 2 === 0 ? Number(kept) : Number(kept) + step;
  return Math.sign(x) * Number(mag.toFixed(ndigits));
}

/** str(float) in Python: integral floats keep a trailing ".0". */
export function pyFloat(x: number): string {
  if (Number.isInteger(x)) return `${x}.0`;
  return String(x);
}

/** Naive UTC ISO timestamp, matching Python's datetime.utcnow().isoformat() style. */
export function nowIso(): string {
  return new Date().toISOString().slice(0, -1);
}

/** Normalize any datetime string to naive UTC ISO (what the original API stored). */
export function toNaiveUtc(v: string | null | undefined): string | null {
  if (v == null) return null;
  const hasTz = /([zZ]|[+-]\d\d:?\d\d)$/.test(v);
  const d = new Date(hasTz ? v : v.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) throw new HttpError(422, [{ loc: ["body"], msg: "Invalid datetime", type: "datetime_parsing" }]);
  return d.toISOString().slice(0, -1);
}

export const uuid = () => crypto.randomUUID();
