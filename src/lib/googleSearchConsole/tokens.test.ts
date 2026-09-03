import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoogleConnectionRecord } from "./connectionStore";

vi.mock("./connectionStore", () => ({
  getConnectionRecord: vi.fn(),
  updateAccessToken: vi.fn(),
  markNeedsReauth: vi.fn(),
}));
vi.mock("./oauthClient", () => ({
  refreshAccessToken: vi.fn(),
}));

const { getConnectionRecord, updateAccessToken, markNeedsReauth } = await import("./connectionStore");
const { refreshAccessToken } = await import("./oauthClient");
const { getValidAccessToken } = await import("./tokens");

const mockedGetConnectionRecord = vi.mocked(getConnectionRecord);
const mockedUpdateAccessToken = vi.mocked(updateAccessToken);
const mockedMarkNeedsReauth = vi.mocked(markNeedsReauth);
const mockedRefreshAccessToken = vi.mocked(refreshAccessToken);

const ORG_ID = "org-1";

function connection(overrides: Partial<GoogleConnectionRecord> = {}): GoogleConnectionRecord {
  return {
    refreshToken: "refresh-token",
    accessToken: "access-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    needsReauth: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("getValidAccessToken", () => {
  it("returns not_connected when there is no stored connection", async () => {
    mockedGetConnectionRecord.mockResolvedValue(null);
    const result = await getValidAccessToken(ORG_ID);
    expect(result).toEqual({ ok: false, reason: "not_connected" });
    expect(mockedRefreshAccessToken).not.toHaveBeenCalled();
  });

  it("returns needs_reauth immediately when the stored connection is already flagged", async () => {
    mockedGetConnectionRecord.mockResolvedValue(connection({ needsReauth: true }));
    const result = await getValidAccessToken(ORG_ID);
    expect(result).toEqual({ ok: false, reason: "needs_reauth" });
    expect(mockedRefreshAccessToken).not.toHaveBeenCalled();
  });

  it("reuses the stored access token when it is not near expiry", async () => {
    mockedGetConnectionRecord.mockResolvedValue(connection({ accessToken: "still-good" }));
    const result = await getValidAccessToken(ORG_ID);
    expect(result).toEqual({ ok: true, accessToken: "still-good" });
    expect(mockedRefreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes when the stored access token is expired", async () => {
    mockedGetConnectionRecord.mockResolvedValue(
      connection({ accessToken: "stale", accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString() }),
    );
    mockedRefreshAccessToken.mockResolvedValue({ ok: true, accessToken: "fresh", expiresInSeconds: 3600 });

    const result = await getValidAccessToken(ORG_ID);

    expect(result).toEqual({ ok: true, accessToken: "fresh" });
    expect(mockedRefreshAccessToken).toHaveBeenCalledWith("refresh-token");
    expect(mockedUpdateAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, accessToken: "fresh" }),
    );
  });

  it("refreshes when there is no access token stored yet", async () => {
    mockedGetConnectionRecord.mockResolvedValue(connection({ accessToken: null, accessTokenExpiresAt: null }));
    mockedRefreshAccessToken.mockResolvedValue({ ok: true, accessToken: "fresh", expiresInSeconds: 3600 });

    const result = await getValidAccessToken(ORG_ID);

    expect(result).toEqual({ ok: true, accessToken: "fresh" });
  });

  it("marks the connection needs_reauth and reports it when refresh fails with an invalid grant", async () => {
    mockedGetConnectionRecord.mockResolvedValue(
      connection({ accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString() }),
    );
    mockedRefreshAccessToken.mockResolvedValue({ ok: false, needsReauth: true, error: "invalid_grant" });

    const result = await getValidAccessToken(ORG_ID);

    expect(result).toEqual({ ok: false, reason: "needs_reauth" });
    expect(mockedMarkNeedsReauth).toHaveBeenCalledWith(ORG_ID);
  });

  it("reports a transient refresh_failed without marking needs_reauth for a non-invalid-grant error", async () => {
    mockedGetConnectionRecord.mockResolvedValue(
      connection({ accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString() }),
    );
    mockedRefreshAccessToken.mockResolvedValue({ ok: false, needsReauth: false, error: "server_error" });

    const result = await getValidAccessToken(ORG_ID);

    expect(result).toEqual({ ok: false, reason: "refresh_failed" });
    expect(mockedMarkNeedsReauth).not.toHaveBeenCalled();
  });
});
