import type { TravelTimeProvider } from "../travel";
import type { Place, PlaceId, TravelMode } from "../types";

/**
 * Faux fournisseur de trajets pour les tests : temps fixés par paire de lieux (symétriques),
 * 0 pour un même lieu, valeur par défaut sinon. Compte les appels.
 */
export class FakeTravelProvider implements TravelTimeProvider {
  calls = 0;
  private readonly table = new Map<string, number>();

  constructor(
    pairs: Array<[PlaceId, PlaceId, number]> = [],
    private readonly defaultMinutes = 30,
  ) {
    for (const [a, b, min] of pairs) {
      this.table.set(`${a}|${b}`, min);
      this.table.set(`${b}|${a}`, min);
    }
  }

  async minutes(from: Place, to: Place, _mode: TravelMode): Promise<number> {
    void _mode;
    this.calls++;
    if (from.id === to.id) return 0;
    return this.table.get(`${from.id}|${to.id}`) ?? this.defaultMinutes;
  }
}
