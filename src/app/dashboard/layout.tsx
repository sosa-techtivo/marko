import type { ReactNode } from "react";
import Link from "next/link";
import { requireUserAndOrganization } from "@/lib/organizations";
import { MarkoLogo } from "@/components/MarkoLogo";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user, organization } = await requireUserAndOrganization();

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-50">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center">
            <MarkoLogo
              imageClassName="h-5 w-auto sm:h-6"
              textClassName="text-[9px] tracking-widest sm:text-[10px]"
              gapClassName="mt-1.5"
            />
          </Link>
          {organization && (
            <>
              <span className="text-xs text-zinc-400">/</span>
              <span className="text-xs text-zinc-600">{organization.name}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-zinc-500">{user.email}</span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex flex-1 flex-col px-6 py-8">{children}</main>
      {/* Global product signature — a normal-flow block after `main`
          (itself `flex-1` in this `min-h-screen flex-col` shell), so on a
          short page it's pushed to the bottom of the viewport without
          being fixed/sticky, and on a long/scrollable page it simply
          follows the content rather than overlapping it. */}
      <footer className="shrink-0 border-t border-zinc-200 px-6 py-3 text-center text-[11px] text-zinc-400">
        MARKO by{" "}
        <a
          href="https://www.techtivo.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-400 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-600"
        >
          Techtivo
        </a>{" "}
        — Smarter marketing. Clearer decisions.
      </footer>
    </div>
  );
}
