import { describe, expect, it } from "vitest";
import { buildReportFilename } from "./filename";

const DATE = new Date("2026-09-04T15:00:00.000Z");

describe("buildReportFilename", () => {
  it("builds the deterministic, human-readable filename", () => {
    expect(buildReportFilename("Techtivo", DATE)).toBe("MARKO-SEO-Report-Techtivo-2026-09-04.pdf");
  });

  it("sanitizes spaces and punctuation to hyphens", () => {
    expect(buildReportFilename("Acme, Inc.", DATE)).toBe("MARKO-SEO-Report-Acme-Inc-2026-09-04.pdf");
  });

  it("strips accented characters down to their plain ASCII base letters", () => {
    expect(buildReportFilename("Gobernacion de Boyaca", DATE)).toContain("Gobernacion-de-Boyaca");
  });

  it("collapses repeated separators and trims leading/trailing hyphens", () => {
    expect(buildReportFilename("  --Weird///Name--  ", DATE)).toBe(
      "MARKO-SEO-Report-Weird-Name-2026-09-04.pdf",
    );
  });

  it("falls back to a generic label when the name sanitizes to nothing", () => {
    expect(buildReportFilename("###", DATE)).toBe("MARKO-SEO-Report-Site-2026-09-04.pdf");
  });

  it("never includes a UUID or any characters unsafe for a filename", () => {
    const filename = buildReportFilename("Techtivo (Test Org #4)", DATE);
    expect(filename).toMatch(/^MARKO-SEO-Report-[a-zA-Z0-9-]+\.pdf$/);
  });

  it("uses the generation date, not the analysis date", () => {
    expect(buildReportFilename("Techtivo", new Date("2026-01-15T00:00:00.000Z"))).toBe(
      "MARKO-SEO-Report-Techtivo-2026-01-15.pdf",
    );
  });
});
