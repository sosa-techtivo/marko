import { afterEach, describe, expect, it, vi } from "vitest";

// assertSafeToFetch does a real DNS lookup — mocked so these tests never
// depend on network access; every test here targets a normal public host
// and should be treated as safe to fetch.
vi.mock("./ssrfGuard", () => ({ assertSafeToFetch: vi.fn(async () => ({ ok: true })) }));

const { fetchRobotsTxt, parseRobotsTxt, selectApplicableGroup, isPathBlocked } =
  await import("./robotsTxt");

const mockedFetch = vi.fn();
vi.stubGlobal("fetch", mockedFetch);

function textResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return {
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

afterEach(() => {
  mockedFetch.mockReset();
});

describe("fetchRobotsTxt", () => {
  it("treats a missing (404) robots.txt as fully permissive — no group, never blocks", async () => {
    mockedFetch.mockResolvedValue(textResponse(404, ""));

    const result = await fetchRobotsTxt("https://example.com/");

    expect(result.status).toBe(404);
    expect(result.fetchError).toBeNull();
    expect(result.group).toBeNull();
  });

  it("parses a permissive robots.txt (Allow-all) into a group with no blocking rules", async () => {
    mockedFetch.mockResolvedValue(
      textResponse(200, "User-agent: *\nDisallow:\n"),
    );

    const result = await fetchRobotsTxt("https://example.com/");

    expect(result.status).toBe(200);
    expect(result.group).not.toBeNull();
    if (!result.group) return;
    expect(isPathBlocked(result.group, "/anything")).toBe(false);
  });

  it("detects a full-site block (Disallow: /) for every path", async () => {
    mockedFetch.mockResolvedValue(textResponse(200, "User-agent: *\nDisallow: /\n"));

    const result = await fetchRobotsTxt("https://example.com/");

    expect(result.group).not.toBeNull();
    if (!result.group) return;
    expect(isPathBlocked(result.group, "/")).toBe(true);
    expect(isPathBlocked(result.group, "/anything/at/all")).toBe(true);
  });

  it("detects a path-specific block without blocking the rest of the site", async () => {
    mockedFetch.mockResolvedValue(
      textResponse(200, "User-agent: *\nDisallow: /admin\nAllow: /\n"),
    );

    const result = await fetchRobotsTxt("https://example.com/");

    expect(result.group).not.toBeNull();
    if (!result.group) return;
    expect(isPathBlocked(result.group, "/admin")).toBe(true);
    expect(isPathBlocked(result.group, "/admin/settings")).toBe(true);
    expect(isPathBlocked(result.group, "/")).toBe(false);
    expect(isPathBlocked(result.group, "/blog/post-1")).toBe(false);
  });

  it("treats a malformed/unreachable robots.txt as inconclusive — no group, never blocks", async () => {
    mockedFetch.mockRejectedValue(new Error("network error"));

    const result = await fetchRobotsTxt("https://example.com/");

    expect(result.status).toBeNull();
    expect(result.fetchError).toBe("network error");
    expect(result.group).toBeNull();
  });

  it("treats a non-200/404 status (e.g. server error) as inconclusive — no group", async () => {
    mockedFetch.mockResolvedValue(textResponse(500, "Internal Server Error"));

    const result = await fetchRobotsTxt("https://example.com/");

    expect(result.status).toBe(500);
    expect(result.group).toBeNull();
    expect(result.fetchError).not.toBeNull();
  });

  it("never follows a robots.txt redirect — treats it as inconclusive", async () => {
    mockedFetch.mockResolvedValue(textResponse(301, "", { location: "/robots-moved.txt" }));

    const result = await fetchRobotsTxt("https://example.com/");

    expect(result.group).toBeNull();
    expect(result.status).toBe(301);
  });

  it("an explicit googlebot group fully overrides the wildcard group (not merged)", async () => {
    mockedFetch.mockResolvedValue(
      textResponse(
        200,
        [
          "User-agent: *",
          "Disallow: /",
          "",
          "User-agent: googlebot",
          "Disallow: /only-this",
        ].join("\n"),
      ),
    );

    const result = await fetchRobotsTxt("https://example.com/");

    expect(result.group).not.toBeNull();
    if (!result.group) return;
    // The wildcard's blanket "Disallow: /" does NOT apply to googlebot —
    // only its own, more specific group does.
    expect(isPathBlocked(result.group, "/")).toBe(false);
    expect(isPathBlocked(result.group, "/only-this")).toBe(true);
    expect(isPathBlocked(result.group, "/anything-else")).toBe(false);
  });

  it("returns group: null (with a fetchError) when no group applies to googlebot at all", async () => {
    mockedFetch.mockResolvedValue(textResponse(200, "User-agent: bingbot\nDisallow: /\n"));

    const result = await fetchRobotsTxt("https://example.com/");

    expect(result.status).toBe(200);
    expect(result.group).toBeNull();
    expect(result.fetchError).not.toBeNull();
  });
});

describe("parseRobotsTxt", () => {
  it("groups consecutive User-agent lines together, sharing the same directives", () => {
    const groups = parseRobotsTxt(
      ["User-agent: a", "User-agent: b", "Disallow: /x"].join("\n"),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].userAgents).toEqual(["a", "b"]);
    expect(groups[0].directives).toEqual([{ type: "disallow", path: "/x" }]);
  });

  it("starts a new group after a directive line is followed by another User-agent", () => {
    const groups = parseRobotsTxt(
      ["User-agent: a", "Disallow: /x", "User-agent: b", "Disallow: /y"].join("\n"),
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].userAgents).toEqual(["a"]);
    expect(groups[1].userAgents).toEqual(["b"]);
  });

  it("ignores comments, blank lines, and unrelated fields", () => {
    const groups = parseRobotsTxt(
      ["# comment", "", "User-agent: *", "Sitemap: /sitemap.xml", "Disallow: /x # inline comment"].join(
        "\n",
      ),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].directives).toEqual([{ type: "disallow", path: "/x" }]);
  });
});

describe("selectApplicableGroup", () => {
  it("falls back to the wildcard group when no specific group matches", () => {
    const groups = parseRobotsTxt("User-agent: *\nDisallow: /x\n");
    const group = selectApplicableGroup(groups, "googlebot");
    expect(group?.userAgents).toEqual(["*"]);
  });

  it("returns null when neither a specific nor wildcard group exists", () => {
    const groups = parseRobotsTxt("User-agent: bingbot\nDisallow: /x\n");
    expect(selectApplicableGroup(groups, "googlebot")).toBeNull();
  });

  it("merges multiple separate groups that share the same user-agent token, per spec — not just the first one", () => {
    // Reproduces a real-world shape (lendingpoint.com's actual robots.txt):
    // a hand-written `User-agent: *` block followed by a second,
    // plugin-appended `User-agent: *` block later in the same file.
    // Google's spec merges these into one logical group; taking only the
    // first would silently drop the second block's rules.
    const groups = parseRobotsTxt(
      [
        "User-agent: *",
        "Disallow: /wp-admin/admin-ajax.php",
        "",
        "User-agent: *",
        "Disallow: /search/",
      ].join("\n"),
    );
    const group = selectApplicableGroup(groups, "googlebot");
    expect(group).not.toBeNull();
    if (!group) return;
    expect(isPathBlocked(group, "/wp-admin/admin-ajax.php")).toBe(true);
    expect(isPathBlocked(group, "/search/")).toBe(true);
    expect(isPathBlocked(group, "/unrelated-page")).toBe(false);
  });
});

describe("isPathBlocked", () => {
  it("supports wildcard (*) patterns", () => {
    const group = { userAgents: ["*"], directives: [{ type: "disallow" as const, path: "/*.pdf" }] };
    expect(isPathBlocked(group, "/files/report.pdf")).toBe(true);
    expect(isPathBlocked(group, "/files/report.html")).toBe(false);
  });

  it("supports end-anchored ($) patterns", () => {
    const group = { userAgents: ["*"], directives: [{ type: "disallow" as const, path: "/about$" }] };
    expect(isPathBlocked(group, "/about")).toBe(true);
    expect(isPathBlocked(group, "/about/team")).toBe(false);
  });

  it("resolves a tie in matched-length between Allow and Disallow in favor of Allow", () => {
    const group = {
      userAgents: ["*"],
      directives: [
        { type: "disallow" as const, path: "/x" },
        { type: "allow" as const, path: "/x" },
      ],
    };
    expect(isPathBlocked(group, "/x")).toBe(false);
  });

  it("the longer, more specific match wins regardless of directive order", () => {
    const group = {
      userAgents: ["*"],
      directives: [
        { type: "allow" as const, path: "/blog" },
        { type: "disallow" as const, path: "/blog/drafts" },
      ],
    };
    expect(isPathBlocked(group, "/blog/post-1")).toBe(false);
    expect(isPathBlocked(group, "/blog/drafts/wip")).toBe(true);
  });
});
