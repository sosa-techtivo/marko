import { describe, expect, it } from "vitest";
import { extractImages, extractJsonLdBlocks } from "./html";

describe("extractImages", () => {
  it("distinguishes an absent alt attribute from a present-but-empty one", () => {
    const html = `
      <img src="a.jpg">
      <img src="b.jpg" alt="">
      <img src="c.jpg" alt="A description">
    `;
    const images = extractImages(html);
    expect(images).toHaveLength(3);
    expect(images[0]).toMatchObject({ hasAlt: false, altText: null });
    expect(images[1]).toMatchObject({ hasAlt: true, altText: "" });
    expect(images[2]).toMatchObject({ hasAlt: true, altText: "A description" });
  });

  it("extracts role, aria-hidden, width, and height", () => {
    const html = `<img src="pixel.gif" role="presentation" aria-hidden="true" width="1" height="1">`;
    const [img] = extractImages(html);
    expect(img).toMatchObject({
      hasAlt: false,
      role: "presentation",
      ariaHidden: "true",
      width: "1",
      height: "1",
    });
  });

  it("returns an empty array when there are no images", () => {
    expect(extractImages("<html><body>No images here.</body></html>")).toEqual([]);
  });
});

describe("extractJsonLdBlocks", () => {
  it("extracts a single JSON-LD block's raw content", () => {
    const html = `<script type="application/ld+json">{"@type":"Organization"}</script>`;
    expect(extractJsonLdBlocks(html)).toEqual([`{"@type":"Organization"}`]);
  });

  it("extracts multiple JSON-LD blocks in document order", () => {
    const html = `
      <script type="application/ld+json">{"@type":"Organization"}</script>
      <script>var notJsonLd = 1;</script>
      <script type="application/ld+json">{"@type":"WebSite"}</script>
    `;
    expect(extractJsonLdBlocks(html)).toEqual([
      `{"@type":"Organization"}`,
      `{"@type":"WebSite"}`,
    ]);
  });

  it("matches the type attribute case-insensitively", () => {
    const html = `<script type="Application/Ld+Json">{"a":1}</script>`;
    expect(extractJsonLdBlocks(html)).toEqual([`{"a":1}`]);
  });

  it("returns an empty array when there is no structured data", () => {
    expect(extractJsonLdBlocks("<html><head></head><body></body></html>")).toEqual([]);
  });

  it("does not decode HTML entities in the raw JSON text", () => {
    const html = `<script type="application/ld+json">{"name":"Fish &amp; Chips"}</script>`;
    // The raw script content must pass through untouched — decoding would
    // corrupt otherwise-valid JSON (analyze.ts is responsible for parsing).
    expect(extractJsonLdBlocks(html)).toEqual([`{"name":"Fish &amp; Chips"}`]);
  });
});
