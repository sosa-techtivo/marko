import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserAndOrganization } from "@/lib/organizations";

async function createOrganization(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirect("/dashboard?error=missing-org-name");
  }

  const { error } = await supabase.rpc("create_organization", {
    org_name: name,
  });

  if (error) {
    console.error("[createOrganization] create_organization RPC failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    redirect("/dashboard?error=org-save-failed");
  }

  redirect("/dashboard");
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { organization } = await requireUserAndOrganization();

  if (!organization) {
    return (
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-xl font-semibold text-zinc-900">
          Create your organization
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Set up your client/business account before adding a site.
        </p>
        <form action={createOrganization} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="name" className="text-sm font-medium text-zinc-700">
              Organization name
            </label>
            <input
              id="name"
              name="name"
              required
              placeholder="Acme Inc."
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error === "missing-org-name"
                ? "Please provide an organization name."
                : "Something went wrong creating the organization. Please try again."}
            </p>
          )}
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Create organization
          </button>
        </form>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: sites } = await supabase
    .from("sites")
    .select("id, name, url, created_at")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">Sites</h1>
        <Link
          href="/dashboard/sites/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Add site
        </Link>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error === "site-not-found"
            ? "That site could not be found."
            : "Something went wrong. Please try again."}
        </p>
      )}

      {!sites || sites.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
          <p className="text-sm font-medium text-zinc-900">No sites yet</p>
          <p className="mt-1 text-sm text-zinc-500">
            Add your first website to get started with MARKO.
          </p>
          <Link
            href="/dashboard/sites/new"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Add site
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
          {sites.map((site) => (
            <li key={site.id}>
              <Link
                href={`/dashboard/sites/${site.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-900">{site.name}</p>
                  <p className="text-sm text-zinc-500">{site.url}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
