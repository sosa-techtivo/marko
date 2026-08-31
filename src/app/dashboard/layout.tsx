import type { ReactNode } from "react";
import { requireUserAndOrganization } from "@/lib/organizations";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user, organization } = await requireUserAndOrganization();

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-50">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-zinc-900">MARKO</span>
          {organization && (
            <>
              <span className="text-sm text-zinc-400">/</span>
              <span className="text-sm text-zinc-600">{organization.name}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-500">{user.email}</span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex flex-1 flex-col px-6 py-8">{children}</main>
    </div>
  );
}
