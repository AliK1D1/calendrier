/**
 * Limiteur de débit : exécute les tâches une à la fois, avec au moins `minIntervalMs` entre le
 * début de deux tâches. Sert à respecter la politique de Nominatim (1 requête par seconde au
 * maximum pour toute l'app). Horloge et attente injectées : testable sans vraie attente.
 */

export interface RateLimiterOptions {
  /** Délai minimal entre le début de deux tâches (ms). */
  minIntervalMs: number;
  /** Nombre maximal de tâches en attente ou en cours ; au-delà, refus immédiat. */
  maxQueue: number;
  /** Horloge (ms). Défaut : `Date.now`. */
  now?: () => number;
  /** Attente (ms). Défaut : `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
}

/** Levée quand trop de tâches attendent déjà leur tour. */
export class RateLimitQueueFullError extends Error {
  constructor() {
    super("File d'attente pleine");
    this.name = "RateLimitQueueFullError";
  }
}

export interface RateLimiter {
  /** Planifie `task` ; la promesse donne son résultat (ou son erreur). */
  schedule<T>(task: () => Promise<T>): Promise<T>;
  /** Tâches en attente ou en cours. */
  readonly pending: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { minIntervalMs, maxQueue } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  let lastStart = Number.NEGATIVE_INFINITY;
  let chain: Promise<void> = Promise.resolve();
  let pending = 0;

  return {
    get pending() {
      return pending;
    },
    schedule<T>(task: () => Promise<T>): Promise<T> {
      if (pending >= maxQueue) return Promise.reject(new RateLimitQueueFullError());
      pending++;
      const run = chain.then(async () => {
        try {
          const wait = lastStart + minIntervalMs - now();
          if (wait > 0) await sleep(wait);
          lastStart = now();
          return await task();
        } finally {
          pending--;
        }
      });
      // La suivante attend la fin de celle-ci (succès ou échec) : jamais deux en parallèle.
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
