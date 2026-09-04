import { describe, expect, it } from "vitest";
import { siteDetailPath, siteReportPdfPath } from "./paths";

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("siteDetailPath", () => {
  it("builds a slug-based site detail path", () => {
    expect(siteDetailPath("techtivo")).toBe("/dashboard/sites/techtivo");
  });

  it("builds a distinct path for a collision-suffixed slug", () => {
    expect(siteDetailPath("techtivo-2")).toBe("/dashboard/sites/techtivo-2");
  });

  it("never embeds a UUID-shaped identifier", () => {
    expect(siteDetailPath("techtivo")).not.toMatch(UUID_PATTERN);
  });
});

describe("siteReportPdfPath", () => {
  it("builds a slug-based report path under the site's detail path", () => {
    expect(siteReportPdfPath("techtivo")).toBe("/dashboard/sites/techtivo/report");
  });

  it("never embeds a UUID-shaped identifier", () => {
    expect(siteReportPdfPath("techtivo")).not.toMatch(UUID_PATTERN);
  });
});
