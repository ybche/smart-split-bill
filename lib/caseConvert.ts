// Generic snake_case (Postgres columns) <-> camelCase (frontend/types.ts) conversion.
// Keeps the API response shape identical to the old server.ts/db.json contract
// so frontend components don't need to change.

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function toCamelCase<T = any>(value: any): T {
  if (Array.isArray(value)) {
    return value.map((v) => toCamelCase(v)) as any;
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      out[snakeToCamel(k)] = toCamelCase(v);
    }
    return out;
  }
  return value;
}

export function toSnakeCase(value: any): any {
  if (Array.isArray(value)) {
    return value.map((v) => toSnakeCase(v));
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      out[camelToSnake(k)] = toSnakeCase(v);
    }
    return out;
  }
  return value;
}
