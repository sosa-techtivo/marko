"use client";

import { useRef, useState } from "react";

type Status = "idle" | "pending" | "error";

/**
 * Downloads the site's SEO report PDF via fetch+Blob instead of a plain
 * `<a href>` link — a plain link left the page looking frozen while the
 * server rendered the PDF (no loading feedback, no way to show an error).
 * PDF generation itself is unchanged and still fully server-side (the
 * route this fetches — src/app/dashboard/sites/[slug]/report/route.ts —
 * still does the same auth/tenant checks and rendering); this only changes
 * how the browser is told to download the response.
 *
 * Same-origin `fetch` automatically sends the session cookie the route's
 * `requireUserAndOrganization()` needs, without this component ever
 * touching a credential directly.
 */
export function DownloadReportButton({ href }: { href: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const isPending = useRef(false);

  async function handleClick() {
    if (isPending.current) return;
    isPending.current = true;
    setStatus("pending");

    try {
      const response = await fetch(href);
      const contentType = response.headers.get("Content-Type") ?? "";
      if (!response.ok || !contentType.includes("application/pdf")) {
        throw new Error("PDF generation failed");
      }

      const filename = parseFilename(response.headers.get("Content-Disposition")) ?? "MARKO-SEO-Report.pdf";
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);

      setStatus("idle");
    } catch {
      setStatus("error");
    } finally {
      isPending.current = false;
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "pending"}
        aria-busy={status === "pending"}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 outline-none hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "pending" ? "Generating PDF…" : "Download PDF"}
      </button>
      {status === "error" && (
        <span role="alert" className="text-[11px] text-red-600">
          Couldn&apos;t generate the PDF. Please try again.
        </span>
      )}
    </div>
  );
}

function parseFilename(disposition: string | null): string | null {
  if (!disposition) return null;
  const match = /filename="([^"]+)"/.exec(disposition);
  return match ? match[1] : null;
}
