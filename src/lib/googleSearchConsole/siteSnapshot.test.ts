import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./tokens", () => ({ getValidAccessToken: vi.fn() }));
vi.mock("./client", () => ({ querySearchAnalytics: vi.fn() }));

const { getValidAccessToken } = await import("./tokens");
const { querySearchAnalytics } = await import("./client");
const { getSiteSearchConsoleSnapshot } = await import("./siteSnapshot");

const mockedGetValidAccessToken = vi.mocked(getValidAccessToken);
const mockedQuerySearchAnalytics = vi.mocked(querySearchAnalytics);

const ORG_ID = "org-1";
const PROPERTY = "https://example.com/";
const REFERENCE_DATE = new Date("2026-09-02T00:00:00.000Z");

afterEach(() => {
  vi.clearAllMocks();
});

describe("getSiteSearchConsoleSnapshot", () => {
  it("returns not_connected without querying Search Console when there is no token", async () => {
    mockedGetValidAccessToken.mockResolvedValue({ ok: false, reason: "not_connected" });

    const result = await getSiteSearchConsoleSnapshot(ORG_ID, PROPERTY, REFERENCE_DATE);

    expect(result).toEqual({ status: "not_connected" });
    expect(mockedQuerySearchAnalytics).not.toHaveBeenCalled();
  });

  it("returns needs_reauth without querying Search Console when the token needs reauth", async () => {
    mockedGetValidAccessToken.mockResolvedValue({ ok: false, reason: "needs_reauth" });

    const result = await getSiteSearchConsoleSnapshot(ORG_ID, PROPERTY, REFERENCE_DATE);

    expect(result).toEqual({ status: "needs_reauth" });
    expect(mockedQuerySearchAnalytics).not.toHaveBeenCalled();
  });

  it("queries both the current and previous 28-day periods and aggregates them into one snapshot", async () => {
    mockedGetValidAccessToken.mockResolvedValue({ ok: true, accessToken: "token" });
    mockedQuerySearchAnalytics.mockImplementation(async (_token, _site, range) => {
      if (range.startDate === "2026-08-03") {
        return { ok: true, rows: [{ clicks: 100, impressions: 2000, ctr: 0.05, position: 6 }] };
      }
      return { ok: true, rows: [{ clicks: 80, impressions: 1600, ctr: 0.05, position: 8 }] };
    });

    const result = await getSiteSearchConsoleSnapshot(ORG_ID, PROPERTY, REFERENCE_DATE);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.snapshot.current).toMatchObject({ clicks: 100, impressions: 2000, hasData: true });
    expect(result.snapshot.previous).toMatchObject({ clicks: 80, impressions: 1600, hasData: true });
    expect(result.snapshot.delta).toEqual({ clicks: 20, impressions: 400, ctr: 0, position: -2 });
    expect(mockedQuerySearchAnalytics).toHaveBeenCalledTimes(2);
    expect(mockedQuerySearchAnalytics).toHaveBeenCalledWith("token", PROPERTY, { startDate: "2026-08-03", endDate: "2026-08-30" });
    expect(mockedQuerySearchAnalytics).toHaveBeenCalledWith("token", PROPERTY, { startDate: "2026-07-06", endDate: "2026-08-02" });
  });

  it("handles a brand-new property with no data for either period", async () => {
    mockedGetValidAccessToken.mockResolvedValue({ ok: true, accessToken: "token" });
    mockedQuerySearchAnalytics.mockResolvedValue({ ok: true, rows: [] });

    const result = await getSiteSearchConsoleSnapshot(ORG_ID, PROPERTY, REFERENCE_DATE);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.snapshot.current.hasData).toBe(false);
    expect(result.snapshot.delta).toBeNull();
  });

  it("surfaces a Search Console API error for the current period", async () => {
    mockedGetValidAccessToken.mockResolvedValue({ ok: true, accessToken: "token" });
    mockedQuerySearchAnalytics.mockResolvedValue({ ok: false, error: "Google Search Console returned an unexpected error (HTTP 500)." });

    const result = await getSiteSearchConsoleSnapshot(ORG_ID, PROPERTY, REFERENCE_DATE);

    expect(result).toEqual({
      status: "error",
      message: "Google Search Console returned an unexpected error (HTTP 500).",
    });
  });
});
