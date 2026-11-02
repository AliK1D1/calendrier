import { type NextRequest, NextResponse } from "next/server";

import { GeocodeError, type GeocodeErrorCode } from "@/lib/geocoding/geocoder";
import { getGeocoder } from "@/lib/geocoding/server";
import { getCurrentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MESSAGES: Record<GeocodeErrorCode, { status: number; message: string }> = {
  requete: { status: 400, message: "" },
  occupe: {
    status: 503,
    message: "Le service de recherche d'adresses est occupé. Réessaie dans quelques secondes.",
  },
  indisponible: {
    status: 502,
    message: "Le service de recherche d'adresses ne répond pas. Réessaie plus tard.",
  },
};

/**
 * GET /api/geocode?q=… : recherche d'adresse (Nominatim), réservée aux personnes connectées.
 * Le navigateur passe toujours par ici : User-Agent de l'app, cache et 1 requête/s.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });

  try {
    const results = await getGeocoder().search(request.nextUrl.searchParams.get("q"));
    return NextResponse.json(
      { results },
      { headers: { "Cache-Control": "private, max-age=3600" } },
    );
  } catch (err) {
    if (err instanceof GeocodeError) {
      const { status, message } = MESSAGES[err.code];
      if (err.code !== "requete") console.error("Géocodage :", err.message);
      return NextResponse.json({ error: message || err.message }, { status });
    }
    console.error("Géocodage :", err);
    return NextResponse.json({ error: MESSAGES.indisponible.message }, { status: 500 });
  }
}
