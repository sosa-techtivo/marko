import { afterEach, describe, expect, it, vi } from "vitest";
import type { requireUserAndOrganization as RequireUserAndOrganization } from "@/lib/organizations";
import type { createClient as CreateClient } from "@/lib/supabase/server";

vi.mock("@/lib/organizations", () => ({ requireUserAndOrganization: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/googleSearchConsole/tokens", () => ({ getValidAccessToken: vi.fn() }));
vi.mock("@/lib/googleSearchConsole/client", () => ({ listSearchConsoleProperties: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireUserAndOrganization } = await import("@/lib/organizations");
const { createClient } = await import("@/lib/supabase/server");
const { getValidAccessToken } = await import("@/lib/googleSearchConsole/tokens");
const { listSearchConsoleProperties } = await import("@/lib/googleSearchConsole/client");
const { associateSiteProperty, clearSiteProperty } = await import("./googleSearchConsoleActions");

const mockedRequireUserAndOrganization = vi.mocked(requireUserAndOrganization);
const mockedCreateClient = vi.mocked(createClient);
const mockedGetValidAccessToken = vi.mocked(getValidAccessToken);
const mockedListSearchConsoleProperties = vi.mocked(listSearchConsoleProperties);

type AuthResult = Awaited<ReturnType<typeof RequireUserAndOrganization>>;
type SupabaseServerClient = Awaited<ReturnType<typeof CreateClient>>;

const USER = { id: "user-1" } as AuthResult["user"];
const ORG = { id: "org-1", name: "Acme" };

function authed(organization: AuthResult["organization"] = ORG): AuthResult {
  return { user: USER, organization };
}

/** A minimal fake of the one chained query shape (.from().select().eq().eq().maybeSingle())
 * and the .rpc() call this action file actually uses. */
function fakeSupabase(options: { siteFound: boolean; rpcError?: { code: string; message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ error: options.rpcError ?? null });
  const maybeSingle = vi.fn().mockResolvedValue({ data: options.siteFound ? { id: "site-1" } : null });
  const eq2 = vi.fn().mockReturnValue({ maybeSingle });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockReturnValue({ select });
  return { from, rpc } as unknown as SupabaseServerClient & { rpc: typeof rpc; from: typeof from };
}

const OWNED_PROPERTY = { siteUrl: "https://example.com/", permissionLevel: "siteOwner" };

afterEach(() => {
  vi.clearAllMocks();
});

describe("associateSiteProperty — tenant/site access protection", () => {
  it("rejects when the caller has no organization", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed(null));

    const result = await associateSiteProperty("site-1", "https://example.com/", "url_prefix");

    expect(result.ok).toBe(false);
    expect(mockedGetValidAccessToken).not.toHaveBeenCalled();
  });

  it("rejects an invalid property type before calling Google or the database", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed());

    const result = await associateSiteProperty("site-1", "https://example.com/", "not-a-real-type");

    expect(result).toEqual({ ok: false, error: "Invalid property type." });
    expect(mockedGetValidAccessToken).not.toHaveBeenCalled();
  });

  it("rejects a site that does not belong to the caller's organization", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    mockedGetValidAccessToken.mockResolvedValue({ ok: true, accessToken: "token" });
    mockedListSearchConsoleProperties.mockResolvedValue({ ok: true, properties: [OWNED_PROPERTY] });
    const supabase = fakeSupabase({ siteFound: false });
    mockedCreateClient.mockResolvedValue(supabase);

    const result = await associateSiteProperty("site-1", OWNED_PROPERTY.siteUrl, "url_prefix");

    expect(result).toEqual({ ok: false, error: "Site not found." });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("associateSiteProperty — property ownership verification", () => {
  it("rejects a property URL that is not in the connected account's live property list", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    mockedGetValidAccessToken.mockResolvedValue({ ok: true, accessToken: "token" });
    mockedListSearchConsoleProperties.mockResolvedValue({ ok: true, properties: [OWNED_PROPERTY] });
    const supabase = fakeSupabase({ siteFound: true });
    mockedCreateClient.mockResolvedValue(supabase);

    const result = await associateSiteProperty("site-1", "https://not-owned.com/", "url_prefix");

    expect(result.ok).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("saves the property once ownership and site access are both confirmed", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    mockedGetValidAccessToken.mockResolvedValue({ ok: true, accessToken: "token" });
    mockedListSearchConsoleProperties.mockResolvedValue({ ok: true, properties: [OWNED_PROPERTY] });
    const supabase = fakeSupabase({ siteFound: true });
    mockedCreateClient.mockResolvedValue(supabase);

    const result = await associateSiteProperty("site-1", OWNED_PROPERTY.siteUrl, "url_prefix");

    expect(result).toEqual({ ok: true });
    expect(supabase.rpc).toHaveBeenCalledWith("set_site_search_console_property", {
      site_id: "site-1",
      property_url: OWNED_PROPERTY.siteUrl,
      property_type: "url_prefix",
    });
  });

  it("does not call Google's property list when the connection needs reauth", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    mockedGetValidAccessToken.mockResolvedValue({ ok: false, reason: "needs_reauth" });

    const result = await associateSiteProperty("site-1", OWNED_PROPERTY.siteUrl, "url_prefix");

    expect(result.ok).toBe(false);
    expect(mockedListSearchConsoleProperties).not.toHaveBeenCalled();
  });
});

describe("clearSiteProperty — tenant/site access protection", () => {
  it("rejects when the caller has no organization", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed(null));
    const result = await clearSiteProperty("site-1");
    expect(result.ok).toBe(false);
  });

  it("surfaces an RPC failure (e.g. site not in the caller's organization) as a clean error", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    const supabase = fakeSupabase({ siteFound: true, rpcError: { code: "P0001", message: "site not found or not in your organization" } });
    mockedCreateClient.mockResolvedValue(supabase);

    const result = await clearSiteProperty("site-1");

    expect(result).toEqual({ ok: false, error: "Could not clear the selected property." });
  });
});
