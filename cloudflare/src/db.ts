// Small helpers over a Durable Object's synchronous SQLite API.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

function toSql(v: unknown): SqlStorageValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  return JSON.stringify(v);
}

export class Db {
  constructor(private sql: SqlStorage) {}

  all<T extends Row = Row>(query: string, ...args: unknown[]): T[] {
    return this.sql.exec(query, ...args.map(toSql)).toArray() as T[];
  }

  one<T extends Row = Row>(query: string, ...args: unknown[]): T | null {
    return this.all<T>(query, ...args)[0] ?? null;
  }

  scalar<T = unknown>(query: string, ...args: unknown[]): T | null {
    const r = this.sql.exec(query, ...args.map(toSql)).raw().next();
    return r.done ? null : ((r.value as unknown[])[0] as T);
  }

  run(query: string, ...args: unknown[]): number {
    return this.sql.exec(query, ...args.map(toSql)).rowsWritten;
  }

  insert(table: string, row: Row): void {
    const cols = Object.keys(row);
    this.sql.exec(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      ...cols.map((c) => toSql(row[c])),
    );
  }

  /** UPDATE only the keys present in `patch` (pydantic exclude_unset semantics). */
  update(table: string, id: string, patch: Row): void {
    const cols = Object.keys(patch).filter((k) => patch[k] !== undefined);
    if (!cols.length) return;
    this.sql.exec(
      `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
      ...cols.map((c) => toSql(patch[c])),
      id,
    );
  }

  get(table: string, id: string): Row | null {
    return this.one(`SELECT * FROM ${table} WHERE id = ?`, id);
  }
}

/** Drop keys whose value is null/undefined (for "only update if not None" endpoints). */
export function nonNull(obj: Row): Row {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
}
