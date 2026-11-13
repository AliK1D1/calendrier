"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Flash } from "@/components/flash-message";
import { addMinutesTo, zonedTime } from "@/lib/scheduling/time";
import { formatClock, MINUTES_PER_DAY } from "@/lib/scheduling/weeklyBlocks";
import type { SessionView, StudyPlanView } from "@/lib/study/service";
import { plural } from "@/lib/ux/plural";

import type { StudyProps } from "./types";

/** Les séances proposées restent affichées si on recharge la page (ce navigateur seulement). */
const STORAGE_KEY = "tlc-etude-propositions";
const STORAGE_MAX_AGE_MS = 3 * 60 * 60 * 1000;

function readSaved(): StudyPlanView | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { plan?: StudyPlanView; savedAt?: number };
    if (
      !saved.plan ||
      !Array.isArray(saved.plan.sessions) ||
      !Array.isArray(saved.plan.warnings) ||
      typeof saved.savedAt !== "number" ||
      Date.now() - saved.savedAt > STORAGE_MAX_AGE_MS
    ) {
      return null;
    }
    return saved.plan;
  } catch {
    return null;
  }
}

function writeSaved(plan: StudyPlanView | null) {
  try {
    if (plan) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ plan, savedAt: Date.now() }));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Stockage indisponible (navigation privée…) : les propositions restent en mémoire.
  }
}

/** Ce que le serveur attend pour revalider ou accepter une séance. */
export function sessionInput(s: SessionView) {
  return {
    key: s.key,
    deadlineId: s.deadlineId,
    start: s.start,
    end: s.end,
    placeId: s.placeId,
    kind: s.kind,
    replacesId: s.replacesId,
  };
}

/**
 * Séances d'étude proposées dans /horaire : calcul (planifier, replanifier), déplacement
 * revalidé par le serveur, acceptation, refus. Rien n'est écrit avant « Accepter ».
 */
export function useStudyPlan(
  study: StudyProps | undefined,
  { onFlash, onShow }: { onFlash: (f: Flash) => void; onShow: (s: SessionView) => void },
) {
  const router = useRouter();
  const [plan, setPlanState] = useState<StudyPlanView | null>(null);
  const [loading, setLoading] = useState<"planifier" | "replanifier" | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const started = useRef(false);

  const setPlan = useCallback((next: StudyPlanView | null) => {
    setPlanState(next);
    writeSaved(next && next.sessions.length + next.warnings.length > 0 ? next : null);
  }, []);

  const run = useCallback(
    async (kind: "planifier" | "replanifier") => {
      if (!study) return;
      setLoading(kind);
      setErrorKey(null);
      onFlash(null);
      try {
        const r =
          kind === "planifier"
            ? await study.actions.planifierEtude()
            : await study.actions.replanifierConflits();
        if (!r.ok) {
          onFlash({ type: "erreur", text: r.error });
          return;
        }
        setPlan(r.value);
        const first = r.value.sessions[0];
        if (first) onShow(first);
        else if (r.value.warnings.length === 0) {
          onFlash({ type: "ok", text: "Tout est déjà planifié : rien de plus à proposer." });
        }
      } catch {
        onFlash({ type: "erreur", text: "Le calcul n'a pas fonctionné. Réessaie." });
      } finally {
        setLoading(null);
        // L'adresse ne relance plus le calcul si on recharge la page.
        if (window.location.search.includes("etude=")) {
          router.replace("/horaire", { scroll: false });
        }
      }
    },
    [study, onFlash, onShow, setPlan, router],
  );

  useEffect(() => {
    if (!study || started.current) return;
    started.current = true;
    if (study.start) void run(study.start);
    else {
      const saved = readSaved();
      if (saved) setPlanState(saved);
    }
  }, [study, run]);

  /** Déplace une séance (glisser ou flèches) : le serveur la revalide avant qu'elle bouge. */
  const move = useCallback(
    async (key: string, day: string, startMinute: number) => {
      if (!study || !plan) return;
      const s = plan.sessions.find((x) => x.key === key);
      if (!s) return;
      const duration = (Date.parse(s.end) - Date.parse(s.start)) / 60_000;
      if (startMinute < 0 || startMinute + duration > MINUTES_PER_DAY) return;
      const start = zonedTime(day, formatClock(startMinute));
      const moved = {
        ...sessionInput(s),
        start: start.toISOString(),
        end: addMinutesTo(start, duration).toISOString(),
      };
      setBusy(true);
      setErrorKey(null);
      try {
        const r = await study.actions.verifierSeance({
          session: moved,
          others: plan.sessions.filter((x) => x.key !== key).map(sessionInput),
        });
        if (!r.ok) {
          setErrorKey(key);
          onFlash({ type: "erreur", text: `Séance non déplacée : ${r.error}` });
          return;
        }
        setPlan({
          ...plan,
          sessions: plan.sessions
            .map((x) => (x.key === key ? r.value : x))
            .sort((a, b) => a.start.localeCompare(b.start)),
        });
        onFlash({ type: "ok", text: `Séance déplacée : ${r.value.label}.` });
      } catch {
        onFlash({ type: "erreur", text: "La vérification n'a pas fonctionné. Réessaie." });
      } finally {
        setBusy(false);
      }
    },
    [study, plan, onFlash, setPlan],
  );

  const nudge = useCallback(
    (key: string, minutes: number) => {
      const s = plan?.sessions.find((x) => x.key === key);
      if (s) void move(key, s.day, s.startMinute + minutes);
    },
    [plan, move],
  );

  const refuse = useCallback(
    (keys: string[]) => {
      if (!plan) return;
      const rest = plan.sessions.filter((s) => !keys.includes(s.key));
      setErrorKey(null);
      setPlan(rest.length === 0 ? null : { ...plan, sessions: rest });
      onFlash({
        type: "ok",
        text:
          rest.length === 0
            ? "Propositions retirées. Rien n'a été ajouté à ton horaire."
            : `${plural(keys.length, "séance refusée", "séances refusées")}.`,
      });
    },
    [plan, onFlash, setPlan],
  );

  const accept = useCallback(
    async (keys: string[]) => {
      if (!study || !plan) return;
      const chosen = plan.sessions.filter((s) => keys.includes(s.key));
      if (chosen.length === 0) return;
      setBusy(true);
      setErrorKey(null);
      try {
        const r = await study.actions.accepterSeances(chosen.map(sessionInput));
        if (!r.ok) {
          if (r.key) setErrorKey(r.key);
          onFlash({ type: "erreur", text: r.error });
          return;
        }
        const rest = plan.sessions.filter((s) => !keys.includes(s.key));
        setPlan(rest.length === 0 ? null : { ...plan, sessions: rest });
        onFlash({
          type: "ok",
          text:
            plan.mode === "replan"
              ? `${plural(r.count, "séance déplacée", "séances déplacées")} dans ton horaire.`
              : `${plural(r.count, "séance ajoutée", "séances ajoutées")} à ton horaire.`,
        });
        router.refresh();
      } catch {
        onFlash({ type: "erreur", text: "L'enregistrement n'a pas fonctionné. Réessaie." });
      } finally {
        setBusy(false);
      }
    },
    [study, plan, onFlash, setPlan, router],
  );

  return { plan, loading, busy, errorKey, run, move, nudge, refuse, accept };
}
