import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MarkoLogo } from "@/components/MarkoLogo";
import { ProductFooter } from "@/components/ProductFooter";

const PRIMARY_BUTTON_CLASSES =
  "inline-block rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

/**
 * `/` — public landing page for logged-out visitors; a signed-in user is
 * still sent straight to `/dashboard`, exactly as before this page had a
 * landing page at all. No authenticated data is fetched or rendered here
 * for either case — the "product preview" below is a static, illustrative
 * mock built from plain markup, not a live view of any account's data.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-zinc-200 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <MarkoLogo
            imageClassName="h-5 w-auto sm:h-6"
            textClassName="text-[9px] tracking-widest sm:text-[10px]"
            gapClassName="mt-1.5"
          />
          <Link
            href="/login"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
                Smarter marketing. Clearer decisions.
              </h1>
              <p className="mt-4 max-w-md text-base text-zinc-600">
                MARKO turns your website&apos;s SEO data into clear insights, prioritized
                opportunities, and actionable recommendations.
              </p>
              <Link href="/login" className={`${PRIMARY_BUTTON_CLASSES} mt-8`}>
                Sign in to MARKO
              </Link>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section className="border-t border-zinc-200 bg-primary-tint px-6 py-16">
          <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-3">
            <ValueCard
              title="Understand your SEO health"
              copy="Know where your website stands today."
            />
            <ValueCard
              title="Prioritize what matters"
              copy="Turn technical findings into clear, actionable opportunities."
            />
            <ValueCard
              title="Track your progress"
              copy="See what changed over time and connect SEO work with organic search performance."
            />
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-16">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
                From analysis to client-ready reporting.
              </h2>
              <p className="mt-4 text-sm text-zinc-600">
                Combine technical SEO analysis with organic search performance and turn it into
                clear, downloadable reports your team can act on.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-zinc-600">
                {[
                  "SEO analysis",
                  "Prioritized insights",
                  "Progress tracking",
                  "Search Console performance",
                  "Downloadable SEO reports",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <ReportPreview />
          </div>
        </section>

        <section className="border-t border-zinc-200 bg-primary-tint px-6 py-16 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
            Ready to see what MARKO finds?
          </h2>
          <Link href="/login" className={`${PRIMARY_BUTTON_CLASSES} mt-6`}>
            Sign in to MARKO
          </Link>
        </section>
      </main>

      <ProductFooter />
    </div>
  );
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-lg font-semibold text-zinc-900">{value}</p>
      <p className="text-[10px] text-zinc-500">{label}</p>
    </div>
  );
}

/** A compact, static mock of the site detail dashboard's own visual
 * language (health status pill, KPI stat tiles, a priority opportunity
 * card, organic performance stats) — plain markup and illustrative
 * numbers only, not a live or real account's data, and not the actual
 * dashboard components (which fetch real data this public page must
 * never touch). */
function ProductPreview() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-900">Current SEO Health</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-medium text-amber-700">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
          Needs attention
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-zinc-100 pt-4">
        <MiniStat value="42" label="Pages analyzed" />
        <MiniStat value="12" label="Opportunities" />
        <MiniStat value="2" label="High-priority" />
      </div>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <div className="flex items-center gap-1.5">
          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-800">
            Medium priority
          </span>
          <span className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[9px] font-medium text-zinc-500">
            Metadata
          </span>
        </div>
        <p className="mt-1.5 text-xs font-semibold text-zinc-900">Missing meta descriptions</p>
        <p className="text-[10px] text-zinc-500">Affects 9 of 42 analyzed pages</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-zinc-100 pt-4">
        <MiniStat value="1,204" label="Organic impressions" />
        <MiniStat value="26.5" label="Avg. position" />
      </div>
    </div>
  );
}

function ValueCard({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      <p className="mt-2 text-sm text-zinc-600">{copy}</p>
    </div>
  );
}

/** Static mock pairing a small illustrative progress trend with a
 * downloadable-report row — the same "progress over time" and "PDF
 * report" capabilities the reporting copy beside it describes, shown as
 * plain markup rather than a screenshot or the real chart/download
 * components (which require an authenticated site's real data). */
function ReportPreview() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-900">SEO Progress</span>
        <span className="text-[10px] text-zinc-400">Last 3 analyses</span>
      </div>
      <div className="mt-5 flex h-16 items-end gap-2.5">
        <div className="h-[45%] w-7 rounded-t bg-primary/30" aria-hidden="true" />
        <div className="h-[70%] w-7 rounded-t bg-primary/60" aria-hidden="true" />
        <div className="h-full w-7 rounded-t bg-primary" aria-hidden="true" />
      </div>
      <div className="mt-5 flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5">
        <span className="text-[11px] text-zinc-600">MARKO-SEO-Report.pdf</span>
        <span className="text-[10px] font-semibold text-primary-strong">Download</span>
      </div>
    </div>
  );
}
