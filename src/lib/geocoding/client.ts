/**
 * Lecture de la réponse de notre route /api/geocode côté navigateur (fonction pure, testée).
 */
import type { GeocodeResult } from "./nominatim";

export type GeocodeApiResult =
  { ok: true; results: GeocodeResult[] } | { ok: false; error: string };

function isResult(v: unknown): v is GeocodeResult {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    typeof r.address === "string" &&
    typeof r.lat === "number" &&
    typeof r.lng === "number" &&
    (r.kind === null || typeof r.kind === "string")
  );
}

export function readGeocodeApiResponse(status: number, json: unknown): GeocodeApiResult {
  const body = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
  if (status === 401) return { ok: false, error: "Ta session a expiré. Reconnecte-toi." };
  if (status < 200 || status >= 300 || !Array.isArray(body.results)) {
    return {
      ok: false,
      error:
        typeof body.error === "string" && body.error
          ? body.error
          : "La recherche n'a pas fonctionné. Réessaie.",
    };
  }
  return { ok: true, results: body.results.filter(isResult) };
}
