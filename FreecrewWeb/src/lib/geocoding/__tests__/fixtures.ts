/**
 * VRAIE réponse de Nominatim, capturée le 2026-11-02 avec :
 *   GET https://nominatim.openstreetmap.org/search?q=Cégep Édouard-Montpetit&format=jsonv2
 *       &limit=5&countrycodes=ca&accept-language=fr
 *   User-Agent: Freecrew/0.1 (projet étudiant)
 * À noter : Nominatim renvoie d'abord des arrêts d'autobus ; le cégep lui-même
 * (amenity/university, ~45.5359, -73.4939) n'arrive qu'en 4e position.
 * Données © les contributeurs d'OpenStreetMap, ODbL 1.0.
 */
export const CEGEP_EDOUARD_MONTPETIT = [
  {
    place_id: 365963000,
    licence: "Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright",
    osm_type: "node",
    osm_id: 6133354174,
    lat: "45.5366770",
    lon: "-73.4962760",
    category: "highway",
    type: "bus_stop",
    place_rank: 30,
    importance: 5.983901731894434e-5,
    addresstype: "highway",
    name: "Cégep Édouard Montpetit",
    display_name:
      "Cégep Édouard Montpetit, Rue Thurber, Vieux-Longueuil, Le Vieux-Longueuil, Longueuil, Agglomération de Longueuil, Montérégie, Québec, J4H 1Y9, Canada",
    boundingbox: ["45.5366270", "45.5367270", "-73.4963260", "-73.4962260"],
  },
  {
    place_id: 364914140,
    licence: "Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright",
    osm_type: "node",
    osm_id: 6133455948,
    lat: "45.5369540",
    lon: "-73.4953060",
    category: "highway",
    type: "bus_stop",
    place_rank: 30,
    importance: 5.983901731894434e-5,
    addresstype: "highway",
    name: "Cégep Édouard-Montpetit",
    display_name:
      "Cégep Édouard-Montpetit, Rue de Gentilly Est, Vieux-Longueuil, Le Vieux-Longueuil, Longueuil, Agglomération de Longueuil, Montérégie, Québec, J4H 4A9, Canada",
    boundingbox: ["45.5369040", "45.5370040", "-73.4953560", "-73.4952560"],
  },
  {
    place_id: 365935442,
    licence: "Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright",
    osm_type: "node",
    osm_id: 11817476637,
    lat: "45.5372461",
    lon: "-73.4949822",
    category: "amenity",
    type: "bicycle_rental",
    place_rank: 30,
    importance: 5.983901731894434e-5,
    addresstype: "amenity",
    name: "Cégep Édouard-Montpetit (de Normandie)",
    display_name:
      "Cégep Édouard-Montpetit (de Normandie), Rue de Gentilly Est, Vieux-Longueuil, Le Vieux-Longueuil, Longueuil, Agglomération de Longueuil, Montérégie, Québec, J4H 4A9, Canada",
    boundingbox: ["45.5371961", "45.5372961", "-73.4950322", "-73.4949322"],
  },
  {
    place_id: 365328267,
    licence: "Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright",
    osm_type: "node",
    osm_id: 6736117856,
    lat: "45.5359358",
    lon: "-73.4938900",
    category: "amenity",
    type: "university",
    place_rank: 30,
    importance: 5.983901731894434e-5,
    addresstype: "amenity",
    name: "Cégep Édouard-Montpetit",
    display_name:
      "Cégep Édouard-Montpetit, Chemin de Chambly, Vieux-Longueuil, Le Vieux-Longueuil, Longueuil, Agglomération de Longueuil, Montérégie, Québec, J4H 4A9, Canada",
    boundingbox: ["45.5358858", "45.5359858", "-73.4939400", "-73.4938400"],
  },
  {
    place_id: 361847304,
    licence: "Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright",
    osm_type: "node",
    osm_id: 6133354087,
    lat: "45.5361730",
    lon: "-73.4960070",
    category: "highway",
    type: "bus_stop",
    place_rank: 30,
    importance: 5.983901731894434e-5,
    addresstype: "highway",
    name: "Cégep Édouard Montpetit",
    display_name:
      "Cégep Édouard Montpetit, Rue de Gentilly Est, Vieux-Longueuil, Le Vieux-Longueuil, Longueuil, Agglomération de Longueuil, Montérégie, Québec, J4H 4A9, Canada",
    boundingbox: ["45.5361230", "45.5362230", "-73.4960570", "-73.4959570"],
  },
];

/** Réponse JSON simulée (statut 200 par défaut). */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
