import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserAndOrganization } from "@/lib/organizations";

async function createSite(formData: FormData) {
  "use server";

  const { organization } = await requireUserAndOrganization();
  if (!organization) {
    redirect("/dashboard");
  }

  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();

  if (!name || !url) {
    redirect("/dashboard/sites/new?error=missing-fields");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("sites").insert({
    organization_id: organization.id,
    name,
    url,
  });

  if (error) {
    redirect("/dashboard/sites/new?error=save-failed");
  }

  redirect("/dashboard");
}

export default async function NewSitePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-xl font-semibold text-zinc-900">Add a site</h1>
      <form action={createSite} className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-sm font-medium text-zinc-700">
            Site name
          </label>
          <input
            id="name"
            name="name"
            required
            placeholder="Acme Inc."
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="url" className="text-sm font-medium text-zinc-700">
            Website URL
          </label>
          <input
            id="url"
            name="url"
            type="url"
            required
            placeholder="https://acme.com"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
        </div>
        {error && (
          <p className="text-sm text-red-600">
            {error === "missing-fields"
              ? "Please provide both a name and a URL."
              : "Something went wrong saving the site. Please try again."}
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Add site
          </button>
        </div>
      </form>
    </div>
  );
}
