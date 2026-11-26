import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Toutes les pages sauf les fichiers statiques et les images de public/ (à la racine).
  // « [^/]+ » et non « .* » : sinon /groupes/abc.png, qui correspond à la page
  // /groupes/[id], échappait au middleware et donc à la protection des pages.
  // /manifest.webmanifest (PWA) aussi : le navigateur le charge sans cookie de session, il
  // serait sinon redirigé vers /connexion et l'app ne serait pas installable.
  // /google<code>.html : fichier de validation Google Search Console (public/), lu sans session.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|google[0-9a-f]+\\.html$|[^/]+\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
