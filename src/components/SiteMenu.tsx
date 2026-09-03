"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  archiveSite,
  restoreSite,
  deleteSitePermanently,
  type SiteLifecycleResult,
} from "@/app/dashboard/sites/actions";

/**
 * Compact "⋯" lifecycle menu for a dashboard SiteCard. The card itself is a
 * <Link> (see SitesGrid.tsx), so every interactive element here stops the
 * click from bubbling to it — otherwise opening the menu, or clicking a
 * menu item, would navigate to the site detail page. The confirmation
 * dialog is rendered via a portal to `document.body` instead, which
 * sidesteps the issue entirely since it's no longer a DOM descendant of
 * the card's <Link>.
 */
export function SiteMenu({
  siteId,
  siteName,
  isArchived,
}: {
  siteId: string;
  siteName: string;
  isArchived: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  function runLifecycleAction(action: () => Promise<SiteLifecycleResult>) {
    setOpen(false);
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      ref={containerRef}
      className="relative shrink-0"
      onClick={(event) => {
        // Never let a click anywhere in this menu bubble to the card's Link.
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        aria-label="Site actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={isPending}
        onClick={() => setOpen((current) => !current)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 outline-none hover:bg-zinc-100 hover:text-zinc-600 focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
          <circle cx="4" cy="10" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="16" cy="10" r="1.5" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-10 mt-1 w-48 rounded-md border border-zinc-200 bg-white py-1 shadow-lg"
        >
          {!isArchived ? (
            <button
              role="menuitem"
              type="button"
              disabled={isPending}
              onClick={() => runLifecycleAction(() => archiveSite(siteId))}
              className="block w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Archive site
            </button>
          ) : (
            <>
              <button
                role="menuitem"
                type="button"
                disabled={isPending}
                onClick={() => runLifecycleAction(() => restoreSite(siteId))}
                className="block w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Restore site
              </button>
              <button
                role="menuitem"
                type="button"
                disabled={isPending}
                onClick={() => {
                  setOpen(false);
                  setConfirmingDelete(true);
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Delete permanently
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="absolute top-full right-0 z-10 mt-1 w-52 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 shadow-lg">
          {error}
        </p>
      )}

      {confirmingDelete &&
        createPortal(
          <DeleteConfirmDialog
            siteName={siteName}
            isPending={isPending}
            onCancel={() => setConfirmingDelete(false)}
            onConfirm={() => {
              setConfirmingDelete(false);
              runLifecycleAction(() => deleteSitePermanently(siteId));
            }}
          />,
          document.body,
        )}
    </div>
  );
}

function DeleteConfirmDialog({
  siteName,
  isPending,
  onCancel,
  onConfirm,
}: {
  siteName: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isPending, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isPending) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg"
      >
        <h2 id={titleId} className="text-lg font-semibold text-zinc-900">
          Delete &ldquo;{siteName}&rdquo; permanently?
        </h2>
        <p className="mt-2 text-sm text-zinc-600">
          This permanently deletes <span className="font-medium text-zinc-900">{siteName}</span>{" "}
          and all of its crawl runs, pages, and issues. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 outline-none hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white outline-none hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Deleting..." : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
