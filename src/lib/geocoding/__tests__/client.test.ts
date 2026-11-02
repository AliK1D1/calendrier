import { describe, expect, it } from "vitest";

import { readGeocodeApiResponse } from "../client";

const cegep = {
  id: "node/6736117856",
  name: "Cégep Édouard-Montpetit",
  address: "Cégep Édouard-Montpetit, Longueuil",
  lat: 45.535936,
  lng: -73.49389,
  kind: "Établissement d'enseignement",
};

describe("readGeocodeApiResponse", () => {
  it("garde les résultats bien formés", () => {
    expect(readGeocodeApiResponse(200, { results: [cegep, { id: 1 }] })).toEqual({
      ok: true,
      results: [cegep],
    });
  });

  it("donne le message d'erreur du serveur, ou un message par défaut", () => {
    expect(readGeocodeApiResponse(503, { error: "Occupé" })).toEqual({
      ok: false,
      error: "Occupé",
    });
    expect(readGeocodeApiResponse(500, null).ok).toBe(false);
    expect(readGeocodeApiResponse(401, {})).toEqual({
      ok: false,
      error: "Ta session a expiré. Reconnecte-toi.",
    });
  });
});
