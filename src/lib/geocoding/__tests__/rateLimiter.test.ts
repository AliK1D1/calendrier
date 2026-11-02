import { describe, expect, it } from "vitest";

import { createRateLimiter, RateLimitQueueFullError } from "../rateLimiter";

/** Horloge simulée : `sleep` avance le temps au lieu d'attendre. */
function fakeClock(start = 10_000) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("createRateLimiter", () => {
  it("espace les tâches d'au moins 1 s et les exécute dans l'ordre", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ minIntervalMs: 1000, maxQueue: 10, ...clock });
    const starts: number[] = [];
    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        limiter.schedule(async () => {
          starts.push(clock.now());
          return n * 10;
        }),
      ),
    );
    expect(results).toEqual([10, 20, 30]);
    expect(starts).toEqual([10_000, 11_000, 12_000]);
    expect(limiter.pending).toBe(0);
  });

  it("n'attend pas si la dernière tâche date de plus d'une seconde", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ minIntervalMs: 1000, maxQueue: 10, ...clock });
    await limiter.schedule(async () => undefined);
    clock.advance(1500);
    const before = clock.now();
    await limiter.schedule(async () => undefined);
    expect(clock.now()).toBe(before);
  });

  it("ne lance jamais deux tâches en parallèle, même lentes", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ minIntervalMs: 1000, maxQueue: 10, ...clock });
    let running = 0;
    let maxRunning = 0;
    const slow = () =>
      limiter.schedule(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
      });
    await Promise.all([slow(), slow(), slow()]);
    expect(maxRunning).toBe(1);
  });

  it("une tâche en erreur ne bloque pas les suivantes", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ minIntervalMs: 1000, maxQueue: 10, ...clock });
    const a = limiter.schedule(async () => {
      throw new Error("boum");
    });
    const b = limiter.schedule(async () => "ok");
    await expect(a).rejects.toThrow("boum");
    await expect(b).resolves.toBe("ok");
    expect(limiter.pending).toBe(0);
  });

  it("refuse au-delà de la taille de file", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ minIntervalMs: 1000, maxQueue: 2, ...clock });
    const a = limiter.schedule(async () => 1);
    const b = limiter.schedule(async () => 2);
    await expect(limiter.schedule(async () => 3)).rejects.toBeInstanceOf(RateLimitQueueFullError);
    await expect(Promise.all([a, b])).resolves.toEqual([1, 2]);
    await expect(limiter.schedule(async () => 4)).resolves.toBe(4);
  });
});
