import { describe, expect, it } from "vitest";
import { generateOAuthState, isSafeInternalPath, isValidOAuthState } from "./oauthState";

describe("generateOAuthState", () => {
  it("generates a non-empty, hex-only token that differs on each call", () => {
    const a = generateOAuthState();
    const b = generateOAuthState();
    expect(a).toMatch(/^[0-9a-f]+$/);
    expect(a.length).toBeGreaterThan(16);
    expect(a).not.toBe(b);
  });
});

describe("isValidOAuthState", () => {
  it("accepts a state that matches exactly what was stored", () => {
    const state = generateOAuthState();
    expect(isValidOAuthState(state, state)).toBe(true);
  });

  it("rejects a state that doesn't match (forged/replayed callback)", () => {
    expect(isValidOAuthState(generateOAuthState(), generateOAuthState())).toBe(false);
  });

  it("rejects when the expected (cookie) state is missing", () => {
    expect(isValidOAuthState(undefined, generateOAuthState())).toBe(false);
    expect(isValidOAuthState(null, generateOAuthState())).toBe(false);
  });

  it("rejects when the received (query param) state is missing", () => {
    expect(isValidOAuthState(generateOAuthState(), null)).toBe(false);
    expect(isValidOAuthState(generateOAuthState(), undefined)).toBe(false);
  });

  it("rejects an empty string on either side", () => {
    expect(isValidOAuthState("", "")).toBe(false);
    expect(isValidOAuthState(generateOAuthState(), "")).toBe(false);
  });

  it("rejects a state of a different length without throwing", () => {
    const state = generateOAuthState();
    expect(() => isValidOAuthState(state, `${state}extra`)).not.toThrow();
    expect(isValidOAuthState(state, `${state}extra`)).toBe(false);
  });
});

describe("isSafeInternalPath", () => {
  it("accepts a plain internal path", () => {
    expect(isSafeInternalPath("/dashboard/sites/abc-123")).toBe(true);
  });

  it("accepts an internal path with a query string", () => {
    expect(isSafeInternalPath("/dashboard/sites/abc-123?tab=history")).toBe(true);
  });

  it("rejects a protocol-relative URL (//host/path)", () => {
    expect(isSafeInternalPath("//evil.example.com/phish")).toBe(false);
  });

  it("rejects an absolute external URL", () => {
    expect(isSafeInternalPath("https://evil.example.com")).toBe(false);
  });

  it("rejects a path containing a backslash", () => {
    expect(isSafeInternalPath("/dashboard\\@evil.example.com")).toBe(false);
  });

  it("rejects a path that doesn't start with a slash", () => {
    expect(isSafeInternalPath("dashboard")).toBe(false);
  });
});
