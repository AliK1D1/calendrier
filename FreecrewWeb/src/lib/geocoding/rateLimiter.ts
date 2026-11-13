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

export interface KeyedLimiterOptions {
  /** Nombre maximal de requêtes par clé (ex. par personne) dans la fenêtre. */
  limit: number;
  /** Durée de la fenêtre glissante (ms). */
  windowMs: number;
  /** Nombre maximal de clés suivies (les plus anciennes sortent en premier). */
  maxKeys?: number;
  /** Horloge (ms). Défaut : `Date.now`. */
  now?: () => number;
}

export interface KeyedLimiter {
  /** Vrai si la requête de `key` est permise (et la compte), faux si la limite est atteinte. */
  tryAcquire(key: string): boolean;
}

/**
 * Limite par personne (fenêtre glissante). La file « 1 requête/s » est partagée par toute
 * l'app : sans cette limite, une seule personne connectée pouvait la remplir en boucle et
 * bloquer la recherche d'adresse pour tout le monde (et faire bannir l'app par Nominatim).
 */
export function createKeyedLimiter(options: KeyedLimiterOptions): KeyedLimiter {
  const { limit, windowMs, maxKeys = 10_000 } = options;
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();

  return {
    tryAcquire(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => at > t - windowMs);
      hits.delete(key);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      while (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest === undefined) break;
        hits.delete(oldest);
      }
      return true;
    },
  };
}
