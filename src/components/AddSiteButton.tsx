"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSite, type CreateSiteState } from "@/app/dashboard/sites/actions";

const initialState: CreateSiteState = { error: null, success: false };

const ERROR_MESSAGES: Record<Exclude<CreateSiteState["error"], null>, string> = {
  "missing-fields": "Please provide both a name and a URL.",
  "save-failed": "Something went wrong saving the site. Please try again.",
  "no-organization": "Something went wrong saving the site. Please try again.",
};

export function AddSiteButton({
  className,
  children = "+ Add site",
  initialOpen = false,
}: {
  className?: string;
  children?: React.ReactNode;
  initialOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);

  function close() {
    setOpen(false);
    if (initialOpen) {
      // Opened via the /dashboard/sites/new compatibility redirect — strip
      // the query param so a later manual refresh doesn't reopen the modal.
      router.replace("/dashboard");
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      {open && <AddSiteModal onClose={close} />}
    </>
  );
}

function AddSiteModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(createSite, initialState);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (state.success) {
      router.refresh();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isPending, onClose]);

  function handleBackdropClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && !isPending) {
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 px-4"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold text-zinc-900">
            Add a site
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Close"
            className="rounded-md p-1 text-zinc-400 outline-none hover:bg-zinc-100 hover:text-zinc-600 focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <form action={formAction} className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="name" className="text-sm font-medium text-zinc-700">
              Site name
            </label>
            <input
              id="name"
              name="name"
              ref={nameInputRef}
              required
              disabled={isPending}
              placeholder="Acme Inc."
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:bg-zinc-50 disabled:text-zinc-400"
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
              disabled={isPending}
              placeholder="https://acme.com"
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:bg-zinc-50 disabled:text-zinc-400"
            />
          </div>
          {state.error && (
            <p className="text-sm text-red-600">{ERROR_MESSAGES[state.error]}</p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 outline-none hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Adding..." : "Add site"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
