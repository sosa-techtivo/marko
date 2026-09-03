import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Documents/enforces the intended `google_connections` access model at
 * the migration-source level. There's no live-Postgres harness in this
 * project's test suite to exercise real GRANT/RLS behavior end to end, so
 * this is the practical alternative: assert the actual SQL that will be
 * applied, so a future migration can't silently reopen this table to
 * anon/authenticated (or drift from what connectionStore.ts actually
 * needs) without a test failing. See 0009_google_search_console.sql and
 * 0010_google_connections_service_role_grant.sql.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, "../../../supabase/migrations");

function readMigration(filename: string): string {
  return readFileSync(join(MIGRATIONS_DIR, filename), "utf-8");
}

const combinedSql = [
  "0009_google_search_console.sql",
  "0010_google_connections_service_role_grant.sql",
].map(readMigration).join("\n");

describe("google_connections access model (migration source)", () => {
  it("never grants any privilege on google_connections to anon or authenticated", () => {
    const grantLines = combinedSql
      .split("\n")
      .filter((line) => /grant\s+.*\son\s+public\.google_connections\b/i.test(line));

    // Sanity check that this test is actually looking at real grant
    // statements, not silently matching nothing.
    expect(grantLines.length).toBeGreaterThan(0);

    for (const line of grantLines) {
      expect(line.toLowerCase()).not.toMatch(/\bto\s+(anon|authenticated)\b/);
    }
  });

  it("grants service_role exactly select, insert, update on google_connections — no delete", () => {
    const match = combinedSql.match(
      /grant\s+([a-z,\s]+?)\s+on\s+public\.google_connections\s+to\s+service_role/i,
    );
    expect(match).not.toBeNull();

    const privileges = match![1]
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .sort();
    expect(privileges).toEqual(["insert", "select", "update"]);
  });

  it("enables row level security on google_connections with no policies for any role", () => {
    expect(combinedSql).toMatch(
      /alter table public\.google_connections enable row level security/i,
    );
    expect(combinedSql).not.toMatch(/create policy[^;]*on public\.google_connections/i);
  });
});
