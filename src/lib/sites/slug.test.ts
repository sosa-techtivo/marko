import { describe, expect, it } from "vitest";
import { resolveUniqueSlug, slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates a normal name", () => {
    expect(slugify("Techtivo")).toBe("techtivo");
    expect(slugify("Acme Marketing Co.")).toBe("acme-marketing-co");
  });

  it("collapses runs of non-alphanumeric characters into a single hyphen", () => {
    expect(slugify("Acme   &   Sons!!")).toBe("acme-sons");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  -Techtivo-  ")).toBe("techtivo");
  });

  it("is URL-safe (only lowercase letters, digits, and hyphens)", () => {
    expect(slugify("Café Déjà Vu & Co. (2024)")).toMatch(/^[a-z0-9-]+$/);
  });

  it("falls back to 'site' when the name has no alphanumeric characters", () => {
    expect(slugify("!!!")).toBe("site");
    expect(slugify("")).toBe("site");
    expect(slugify("   ")).toBe("site");
  });

  it("truncates very long names and trims any trailing hyphen left by truncation", () => {
    const longName = "a".repeat(50) + " " + "b".repeat(50);
    const slug = slugify(longName);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("is deterministic — the same name always produces the same slug", () => {
    expect(slugify("Techtivo")).toBe(slugify("Techtivo"));
  });
});

describe("resolveUniqueSlug — collision handling", () => {
  it("returns the base slug when it isn't taken", () => {
    expect(resolveUniqueSlug("techtivo", [])).toBe("techtivo");
    expect(resolveUniqueSlug("techtivo", ["other-site"])).toBe("techtivo");
  });

  it("appends '-2' when the base slug is taken", () => {
    expect(resolveUniqueSlug("techtivo", ["techtivo"])).toBe("techtivo-2");
  });

  it("finds the first free numbered suffix, in ascending order", () => {
    expect(resolveUniqueSlug("techtivo", ["techtivo", "techtivo-2"])).toBe("techtivo-3");
    expect(resolveUniqueSlug("techtivo", ["techtivo", "techtivo-2", "techtivo-3"])).toBe(
      "techtivo-4",
    );
  });

  it("is not confused by a gap — still picks the first free suffix, not the smallest overall", () => {
    // techtivo-2 is free even though techtivo-3 is taken; the deterministic
    // rule is "first free in ascending order from 2", not "smallest gap".
    expect(resolveUniqueSlug("techtivo", ["techtivo", "techtivo-3"])).toBe("techtivo-2");
  });

  it("is deterministic — the same inputs always produce the same result", () => {
    const existing = ["techtivo", "techtivo-2"];
    expect(resolveUniqueSlug("techtivo", existing)).toBe(resolveUniqueSlug("techtivo", existing));
  });

  it("simulates backfilling several existing same-named sites in a stable order", () => {
    // Mirrors the migration's row-by-row backfill loop (see
    // 0011_site_slugs.sql): process sites in a fixed order, growing the
    // "taken" set as each one is assigned, so results are reproducible.
    const existingSitesOldestFirst = [
      { id: "site-a", name: "Techtivo" },
      { id: "site-b", name: "Techtivo" },
      { id: "site-c", name: "Techtivo" },
    ];

    const taken = new Set<string>();
    const assigned = new Map<string, string>();
    for (const site of existingSitesOldestFirst) {
      const slug = resolveUniqueSlug(slugify(site.name), taken);
      taken.add(slug);
      assigned.set(site.id, slug);
    }

    expect(assigned.get("site-a")).toBe("techtivo");
    expect(assigned.get("site-b")).toBe("techtivo-2");
    expect(assigned.get("site-c")).toBe("techtivo-3");
    // All assigned slugs are unique.
    expect(new Set(assigned.values()).size).toBe(3);
  });
});
