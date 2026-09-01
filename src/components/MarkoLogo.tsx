import Image from "next/image";

/**
 * MARKO's branding lockup: the Techtivo logo asset on top, "MARKO" as real
 * text directly underneath, in the MARKO primary brand color. The image
 * asset (/branding/techtivo-marko.png) contains only the Techtivo mark —
 * it is used exactly as provided, never modified/regenerated — so the
 * "MARKO" wordmark is composed here as text, not part of the image.
 *
 * The brand teal (#339595, ~3.6:1 contrast on white) doesn't meet small
 * body-text contrast, but WCAG 1.4.3 explicitly exempts text that is part
 * of a logo or brand name — this is exactly that case, not body copy.
 */
export function MarkoLogo({
  imageClassName = "h-5 w-auto",
  textClassName = "text-[11px] tracking-widest",
  gapClassName = "mt-0.5",
  align = "start",
  className,
}: {
  imageClassName?: string;
  /** Full control of the "MARKO" text's size/tracking — no default is
   * assumed to remain once a caller overrides this. */
  textClassName?: string;
  /** Vertical spacing between the logo image and the "MARKO" text. */
  gapClassName?: string;
  /** Horizontal alignment of the stacked lockup; "start" (default) matches
   * a conventional left-aligned logo lockup, "center" for centered layouts
   * (e.g. the login page). */
  align?: "start" | "center";
  className?: string;
}) {
  return (
    <span
      className={`inline-flex flex-col leading-none ${align === "center" ? "items-center" : "items-start"} ${className ?? ""}`}
    >
      <Image
        src="/branding/techtivo-marko.png?v=2"
        alt="Techtivo"
        width={217}
        height={47}
        className={imageClassName}
        priority
      />
      <span className={`${gapClassName} font-semibold text-primary ${textClassName}`}>
        MARKO
      </span>
    </span>
  );
}
