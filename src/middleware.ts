import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Toutes les pages sauf les fichiers statiques et les images de public/ (à la racine).
  // « [^/]+ » et non « .* » : sinon /groupes/abc.png, qui correspond à la page
  // /groupes/[id], échappait au middleware et donc à la protection des pages.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|[^/]+\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
