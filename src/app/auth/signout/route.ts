import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Explicit 303: this request is a POST, and /login only has a GET
  // handler. NextResponse.redirect() defaults to 307, which preserves the
  // original method per the HTTP spec — the browser would re-issue the
  // redirect as POST /login, which has no POST handler and returns 405.
  // 303 (See Other) is the correct semantic for "this POST succeeded, now
  // GET this other resource" and forces the follow-up request to GET.
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
