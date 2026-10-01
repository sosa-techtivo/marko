import { describe, expect, it } from "vitest";
import { cleanCompanyName, countUniqueSources, extractCompetitors } from "./competitors";

const CLIENT = { brandName: "Techtivo", siteUrl: "https://www.techtivo.com" };

/** Structure mirrors real captured Gemini web HTML (Angular markup, source
 * chips inside list items, bold leading names). */
const GEMINI_HTML = `
<h3>1. Mid-Sized &amp; Specialized Product Studios</h3>
<ul>
  <li><p data-path-to-node="4,0,0"><b data-index-in-node="0">Leanware</b> (Bogotá) – Highly rated for custom platforms.<!----><sources-carousel-inline><source-inline-chip><button aria-label="View source details for citation from Clutch. Press Enter to open sources dialog."><span class="source-title">Clutch</span></button></source-inline-chip></sources-carousel-inline></p></li>
  <li><p><b data-index-in-node="0">Foonkie Monkey</b> (Bogotá) – A well-established digital product agency.</p></li>
  <li><p><b data-index-in-node="0">Techtivo</b> (Medellín) – The client itself.</p></li>
  <li><p><b data-index-in-node="0">Perficient Latin America</b> (Medellín) – Part of a global consultancy.</p></li>
</ul>
<h3>Key Advantages:</h3>
<ul>
  <li><p><b data-index-in-node="0">Time Zone Alignment:</b> Most Colombian tech hubs operate on EST.</p></li>
  <li><p><b data-index-in-node="0">Simform:</b> A comprehensive software engineering partner.</p></li>
  <li><p><b data-index-in-node="0">Core Expertise:</b> They focus heavily on native iOS.</p></li>
  <li><p>Choose an <b>agile product shop</b> for a new product.</p></li>
</ul>
<rich-list-card><button><div><div><div>Synergy Labs - Mobile App and Web Developers Agency in Miami</div><!----><rich-list-row><div><span>5.0 stars rating</span></div></rich-list-row><rich-list-row><div><span> Open </span></div></rich-list-row></div></div></button></rich-list-card>`;

/** Structure mirrors real captured ChatGPT web HTML (entity payloads, map
 * payload with model-preferred places, a Company table whose names are link
 * references with a domain detail, grouped citation chips). */
const MAP_PAYLOAD = JSON.stringify([
  { name: "BairesDev - Nearshore Software Development & Staff Augmentation", category: "Software company", isModelPreferred: true },
  { name: "Software Company LARS - Artificial Intelligence", isModelPreferred: true },
  { name: "Nearby Pin Only Ltd", isModelPreferred: false },
]).replace(/"/g, "&quot;");
const CHATGPT_HTML = `
<span data-content-reference-type="map"><button data-assistant-map-trigger="" data-assistant-map-payload="${MAP_PAYLOAD}"></button></span>
<div data-assistant-markdown="">
<p>Here are several Colombian options:</p>
<table><thead><tr><th>Company</th><th>Best fit</th></tr></thead><tbody>
<tr><td><button data-assistant-sources-payload="[]" data-content-reference-type="url"><span data-assistant-reference-title="">Perficient</span><span data-assistant-reference-detail="">perficient.com</span></button></td><td>Enterprise</td></tr>
<tr><td><button data-assistant-entity-payload="{&quot;query&quot;:&quot;Ceiba&quot;,&quot;category&quot;:&quot;local_business&quot;}">Ceiba</button></td><td>Digital transformation</td></tr>
<tr><td>PSL/Perficient Latin America</td><td>Complex engineering</td></tr>
<tr><td>Software company</td><td>noise</td></tr>
</tbody></table>
<ul><li><p><strong>Bolder Apps</strong> — A Miami-based app development firm.<span data-content-reference-type="grouped_webpages"><button data-assistant-grouped-webpages-trigger="" aria-label="Clutch, 2 sources">Clutch +1</button></span></p></li></ul>
<button data-assistant-entity-payload="{&quot;query&quot;:&quot;Colombia&quot;,&quot;category&quot;:&quot;country&quot;}">Colombia</button>
</div>`;

describe("extractCompetitors — Gemini web evidence", () => {
  it("extracts bold-led company items and business cards in order, skipping labels, prose bold, and the client", () => {
    expect(extractCompetitors({ answerHtml: GEMINI_HTML, answerText: null }, CLIENT)).toEqual([
      "Leanware",
      "Foonkie Monkey",
      "Perficient Latin America",
      "Simform",
      "Synergy Labs",
    ]);
  });

  it("never treats a citation chip's source name as a competitor", () => {
    expect(extractCompetitors({ answerHtml: GEMINI_HTML, answerText: null }, CLIENT)).not.toContain("Clutch");
  });
});

describe("extractCompetitors — Gemini web nested-list layout (observed live)", () => {
  it("reads 'Name (City):' headings of nested Best for/Overview lists, but not label items or section labels", () => {
    const html = `
<h3>1. Mid-to-Large Scale &amp; Enterprise Partners</h3>
<ul>
  <li><p><b><span>Perficient Latin America (Medellín &amp; Bogotá):<source-footnote><sup data-turn-source-index="1"></sup></source-footnote></span></b><sources-carousel-inline><source-inline-chip><button aria-label="View source details for citation from Clutch.">Clutch</button></source-inline-chip></sources-carousel-inline></p>
    <ul><li><p><i>Best for:</i> Large-scale enterprise solutions.</p></li><li><p><i>Overview:</i> Hundreds of engineers.</p></li></ul></li>
  <li><p><b><span>Ceiba Software (Medellín):</span></b></p>
    <ul><li><p><i>Best for:</i> Custom enterprise software.</p></li></ul></li>
</ul>
<h3>Key Factors to Consider Before Choosing:</h3>
<ul>
  <li><p><b>Engagement Model:</b> Decide between fixed price and dedicated teams.</p></li>
  <li><p><b>Key considerations:</b></p><ul><li><p>Budget</p></li></ul></li>
</ul>`;
    expect(extractCompetitors({ answerHtml: html, answerText: null }, CLIENT)).toEqual([
      "Perficient Latin America",
      "Ceiba Software",
    ]);
  });
});

describe("extractCompetitors — ChatGPT web evidence", () => {
  const competitors = extractCompetitors({ answerHtml: CHATGPT_HTML, answerText: null }, CLIENT);

  it("uses model-preferred map businesses (tagline/category prefix removed), company tables, and company entities", () => {
    expect(competitors).toEqual(["BairesDev", "LARS", "Perficient", "Ceiba", "PSL", "Bolder Apps"]);
  });

  it("ignores map pins the model didn't choose, non-company entities, UI labels, and domain details", () => {
    expect(competitors).not.toContain("Nearby Pin Only Ltd");
    expect(competitors).not.toContain("Colombia");
    expect(competitors).not.toContain("Software company");
    expect(competitors.join(" ")).not.toMatch(/perficient\.com/);
  });

  it("deduplicates longer/shorter forms of the same company, keeping the first", () => {
    expect(competitors.filter((name) => /perficient/i.test(name))).toEqual(["Perficient"]);
  });
});

/** Rendered-markdown prose with inline citation links, as Perplexity's
 * answer container renders it. */
const PERPLEXITY_HTML = `
<div data-renderer="lm" class="prose">
<p>Several Colombian firms stand out <span class="citation"><a href="https://clutch.co/co"><span>clutch+2</span></a></span>.</p>
<ul>
<li><p><strong>Globant</strong> – Large product studio based in Medellín <a href="https://globant.com">1</a></p></li>
<li><p><strong>Techtivo</strong> – The client.</p></li>
<li><p><strong>Medellín</strong> is a strong hub.</p></li>
</ul>
<table><thead><tr><th>Company</th><th>Focus</th></tr></thead><tbody>
<tr><td>Wawandco <a href="https://goodfirms.co/x"><span>goodfirms.co</span></a></td><td>Startups</td></tr>
<tr><td>Globant</td><td>Enterprise</td></tr>
</tbody></table>
</div>`;

describe("extractCompetitors — Perplexity web evidence", () => {
  it("reads bold-led items and company tables, ignoring citation markers, the client, and bold prose words", () => {
    expect(extractCompetitors({ answerHtml: PERPLEXITY_HTML, answerText: null }, CLIENT)).toEqual(["Globant", "Wawandco"]);
  });
});

describe("extractCompetitors — markdown answers (API results)", () => {
  it("applies the same list and company-table conventions to markdown", () => {
    const text = [
      "Options:",
      "1. **Globant** – Large digital product studio.",
      "- **Why Colombia:** Strong talent.",
      "- **Endava:** A global software engineering company.",
      "",
      "| Company | Best fit |",
      "|---|---|",
      "| **Globant** | Enterprise |",
      "| Wawandco | Startups |",
      "| Techtivo | The client |",
    ].join("\n");
    expect(extractCompetitors({ answerHtml: null, answerText: text }, CLIENT)).toEqual(["Globant", "Endava", "Wawandco"]);
  });

  it("returns an empty list when nothing is structurally identifiable as a company", () => {
    expect(extractCompetitors({ answerHtml: null, answerText: "Colombia has many good firms." }, CLIENT)).toEqual([]);
  });
});

describe("cleanCompanyName", () => {
  it("drops listing taglines and category prefixes", () => {
    expect(cleanCompanyName("Bolder Apps | Top Mobile App Developers in Miami")).toBe("Bolder Apps");
    expect(cleanCompanyName("Software Development Company Algoritmo Taller Digital")).toBe("Algoritmo Taller Digital");
    expect(cleanCompanyName("Agnos, Inc. - Custom Software Development")).toBe("Agnos, Inc");
    expect(cleanCompanyName("Leanware (Bogotá)")).toBe("Leanware");
  });
});

describe("countUniqueSources", () => {
  it("counts unique URLs only", () => {
    expect(countUniqueSources([{ url: "https://a.com/x" }, { url: "https://a.com/x" }, { url: "https://b.com/" }])).toBe(2);
  });
});
