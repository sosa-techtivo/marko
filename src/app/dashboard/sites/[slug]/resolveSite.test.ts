import { describe, expect, it, vi } from "vitest";
import type { createClient } from "@/lib/supabase/server";
import { resolveSiteBySlug, type ResolvedSite } from "./resolveSite";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Minimal fake of the one chained query shape this module actually uses
 * (.from().select().eq().eq().maybeSingle()) — same pattern as the
 * `fakeSupabase` helper in googleSearchConsoleActions.test.ts. Records
 * every `.eq()` call so tests can assert exactly which filters were
 * applied, not just the final result. */
function fakeSupabase(row: ResolvedSite | null) {
  const calls: { column: string; value: unknown }[] = [];
  const maybeSingle = vi.fn().mockResolvedValue({ data: row });
  const chain = {
    eq: vi.fn((column: string, value: unknown) => {
      calls.push({ column, value });
      return chain;
    }),
    maybeSingle,
  };
  const select = vi.fn().mockReturnValue(chain);
  const from = vi.fn().mockReturnValue({ select });
  return { supabase: { from } as unknown as SupabaseServerClient, calls, from };
}

const SITE: ResolvedSite = {
  id: "site-1",
  name: "Techtivo",
  url: "https://techtivo.com",
  slug: "techtivo",
  favicon_url: null,
  search_console_property_url: null,
  search_console_property_type: null,
  effective_url: null,
};

describe("resolveSiteBySlug", () => {
  it("resolves a site by slug within the caller's organization", async () => {
    const { supabase } = fakeSupabase(SITE);

    const result = await resolveSiteBySlug(supabase, "org-1", "techtivo");

    expect(result).toEqual(SITE);
  });

  it("scopes the lookup to both organization_id and slug, in that order", async () => {
    const { supabase, calls } = fakeSupabase(SITE);

    await resolveSiteBySlug(supabase, "org-1", "techtivo");

    expect(calls).toEqual([
      { column: "organization_id", value: "org-1" },
      { column: "slug", value: "techtivo" },
    ]);
  });

  it("returns null when no row matches — e.g. the slug belongs to a different organization", async () => {
    // A real cross-tenant collision: "techtivo" exists, but not under
    // "org-2" — the query (correctly scoped by organization_id) finds no
    // row, exactly as if the slug didn't exist at all.
    const { supabase, calls } = fakeSupabase(null);

    const result = await resolveSiteBySlug(supabase, "org-2", "techtivo");

    expect(result).toBeNull();
    expect(calls).toEqual([
      { column: "organization_id", value: "org-2" },
      { column: "slug", value: "techtivo" },
    ]);
  });

  it("returns null for a slug that doesn't exist at all", async () => {
    const { supabase } = fakeSupabase(null);

    const result = await resolveSiteBySlug(supabase, "org-1", "no-such-site");

    expect(result).toBeNull();
  });
});
