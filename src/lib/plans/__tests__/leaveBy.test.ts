import { describe, expect, it } from "vitest";

import { zonedTime } from "@/lib/scheduling/time";
import { EstimatedTravelProvider } from "@/lib/scheduling/travel";
import type { Place, TravelMode } from "@/lib/scheduling/types";
import type { TransitRoute } from "@/lib/travel/googleRoutes";
import type { TransitRouter } from "@/lib/travel/transitRouter";

import {
  computeLeaveBy,
  type LeaveByBlock,
  type LeaveByData,
  type LeaveByTravel,
  leaveByTargets,
  withLeaveBy,
} from "../leaveBy";
import type { PlanView } from "../view";

const D = "2025-09-16"; // mardi
const t = (time: string, day = D) => zonedTime(day, time);
const NOW = t("08:00");

const HOME: Place = { id: "maison", name: "Maison", lat: 45.52, lng: -73.47 };
const CEGEP: Place = { id: "cegep", name: "Cégep", lat: 45.5364, lng: -73.495 };
const CAFE: Place = { id: "cafe", name: "Café", lat: 45.5085, lng: -73.5665 };

/** Trajets fixes (minutes) ; `measured` : la valeur vient « d'une API ». */
function fixedTravel(minutes: number, measured = true): LeaveByTravel & { prefetched: number } {
  const t = {
    prefetched: 0,
    async minutes(from: Place, to: Place) {
      return from.id === to.id ? 0 : minutes;
    },
    async prefetch() {
      t.prefetched++;
    },
    isMeasured: () => measured,
  };
  return t;
}

function block(over: Partial<LeaveByBlock> & Pick<LeaveByBlock, "id">): LeaveByBlock {
  return {
    owner_id: "moi",
    title: "Cours",
    place_id: "cegep",
    start_time: "13:00:00",
    end_time: "15:00:00",
    weekday: 2,
    valid_from: null,
    valid_until: null,
    meetup_plan_id: null,
    ...over,
  };
}

function data(mode: TravelMode, blocks: LeaveByBlock[] = []): LeaveByData {
  return { homePlaceId: "maison", travelMode: mode, blocks, places: [HOME, CEGEP, CAFE] };
}

const target = (start: Date, placeId = "cafe", id = "p1") => ({ id, placeId, start });

describe("computeLeaveBy", () => {
  it("auto : part du cégep (bloc d'avant), départ = début − trajet − marge", async () => {
    const travel = fixedTravel(20);
    const m = await computeLeaveBy([target(t("16:30"))], data("car", [block({ id: "b" })]), {
      travel,
      transit: null,
      budgetKey: "moi",
      now: NOW,
    });
    const v = m.get("p1");
    expect(v?.main).toBe("Pars de « Cégep » à 16 h 05");
    expect(v?.detail).toBe("Arrivée prévue 16 h 25");
    expect(v?.warning).toBeNull();
    expect(v?.note).toBeNull();
    expect(travel.prefetched).toBe(1);
  });

  it("rien avant le plan : part de chez soi", async () => {
    const m = await computeLeaveBy([target(t("10:00"))], data("walk"), {
      travel: fixedTravel(30),
      transit: null,
      budgetKey: "moi",
      now: NOW,
    });
    expect(m.get("p1")?.main).toBe("Pars de chez toi à 9 h 25");
  });

  it("juste après un cours : avertit du retard au lieu d'une heure impossible", async () => {
    const m = await computeLeaveBy(
      [target(t("15:00"))],
      data("bike", [block({ id: "b", end_time: "14:50:00" })]),
      { travel: fixedTravel(17), transit: null, budgetKey: "moi", now: NOW },
    );
    const v = m.get("p1");
    expect(v?.main).toBe("Pars de « Cégep » dès 14 h 50");
    expect(v?.warning).toBe("Tu arriveras vers 15 h 07, 7 min en retard.");
    expect(v?.lateMinutes).toBe(7);
  });

  it("le bloc créé par ce plan ne compte pas comme « lieu d'avant »", async () => {
    const own = block({
      id: "plan-bloc",
      place_id: "cafe",
      start_time: "16:30:00",
      end_time: "18:00:00",
      meetup_plan_id: "p1",
    });
    const early = block({
      id: "plan-bloc-2",
      place_id: "cafe",
      start_time: "16:00:00",
      end_time: "16:40:00",
      meetup_plan_id: "p1",
    });
    const m = await computeLeaveBy([target(t("16:30"))], data("car", [own, early]), {
      travel: fixedTravel(20),
      transit: null,
      budgetKey: "moi",
      now: NOW,
    });
    expect(m.get("p1")?.main).toBe("Pars de chez toi à 16 h 05");
  });

  it("sans API : dit que c'est une estimation", async () => {
    const m = await computeLeaveBy([target(t("16:30"))], data("car"), {
      travel: new EstimatedTravelProvider(),
      transit: null,
      budgetKey: "moi",
      now: NOW,
    });
    expect(m.get("p1")?.note).toBe("Estimation : le vrai temps de trajet n'est pas disponible.");
  });

  it("transport en commun : vrai trajet (ligne et heure), au nom de la personne", async () => {
    const asked: { query: unknown; key: string }[] = [];
    const route: TransitRoute = {
      departAt: t("15:38"),
      arriveAt: t("16:05"),
      legs: [{ vehicle: "Bus", line: "51", headsign: "", stop: "Terminus", departAt: t("15:42") }],
    };
    const transit: TransitRouter = {
      async route(_from, _to, query, key) {
        asked.push({ query, key });
        return route;
      },
    };
    const m = await computeLeaveBy([target(t("16:30"))], data("transit", [block({ id: "b" })]), {
      travel: fixedTravel(30),
      transit,
      budgetKey: "moi",
      now: NOW,
    });
    const v = m.get("p1");
    expect(v?.main).toBe("Pars de « Cégep » à 15 h 38");
    expect(v?.detail).toBe("Arrivée prévue 16 h 05");
    expect(v?.transit).toBe("Bus 51 à 15 h 42 (arrêt Terminus)");
    expect(v?.note).toBeNull();
    expect(asked).toEqual([{ query: { arrivalTime: t("16:25") }, key: "moi" }]);
  });

  it("transport en commun sans horaire réel : estimation, même si la durée vient d'une API", async () => {
    const transit: TransitRouter = { route: async () => null };
    const m = await computeLeaveBy([target(t("16:30"))], data("transit"), {
      travel: fixedTravel(30, true),
      transit,
      budgetKey: "moi",
      now: NOW,
    });
    expect(m.get("p1")?.note).toBe(
      "Estimation : l'horaire du transport en commun n'est pas disponible.",
    );
    expect(m.get("p1")?.transit).toBeNull();
  });

  it("transport en commun loin dans le temps : pas d'appel (estimation)", async () => {
    let calls = 0;
    const transit: TransitRouter = {
      route: async () => {
        calls++;
        return null;
      },
    };
    await computeLeaveBy([target(t("16:30", "2025-10-16"))], data("transit"), {
      travel: fixedTravel(30),
      transit,
      budgetKey: "moi",
      now: NOW,
    });
    expect(calls).toBe(0);
  });

  it("plan au lieu où je suis déjà : pas de trajet", async () => {
    const m = await computeLeaveBy(
      [target(t("16:00"), "cegep")],
      data("car", [block({ id: "b" })]),
      { travel: fixedTravel(20), transit: null, budgetKey: "moi", now: NOW },
    );
    expect(m.get("p1")?.main).toBe("Tu es déjà sur place (« Cégep »).");
    expect(m.get("p1")?.leaveAt).toBeNull();
  });

  it("lieu du plan illisible, ou pas de maison : rien", async () => {
    const opts = { travel: fixedTravel(20), transit: null, budgetKey: "moi", now: NOW };
    expect((await computeLeaveBy([target(t("16:00"), "ailleurs")], data("car"), opts)).size).toBe(
      0,
    );
    const noHome = { ...data("car"), places: [CEGEP, CAFE] };
    expect((await computeLeaveBy([target(t("16:00"))], noHome, opts)).size).toBe(0);
  });

  it("lieu d'un bloc illisible : on suppose la maison", async () => {
    const m = await computeLeaveBy(
      [target(t("16:30"))],
      data("car", [block({ id: "b", place_id: "lieu-secret" })]),
      { travel: fixedTravel(20), transit: null, budgetKey: "moi", now: NOW },
    );
    expect(m.get("p1")?.main).toBe("Pars de chez toi à 16 h 05");
  });

  it("« C'est l'heure de partir ! » quand l'heure de départ est passée", async () => {
    const m = await computeLeaveBy([target(t("16:30"))], data("car"), {
      travel: fixedTravel(20),
      transit: null,
      budgetKey: "moi",
      now: t("16:10"),
    });
    expect(m.get("p1")?.urgent).toBe("C'est l'heure de partir !");
  });
});

function view(id: string, startsAt: string, over: Partial<PlanView> = {}): PlanView {
  return {
    id,
    groupId: "g",
    groupName: "Gang",
    title: "On se voit",
    dayLabel: "",
    timeLabel: "",
    startsAt,
    endsAt: startsAt,
    where: "Café",
    creatorName: "Sam",
    isMine: false,
    invited: true,
    myResponse: "yes",
    state: "upcoming",
    accepted: [],
    declined: [],
    waiting: [],
    wholeGroup: true,
    repeatLabel: null,
    series: null,
    placeId: "cafe",
    ...over,
  };
}

describe("leaveByTargets", () => {
  const iso = (time: string) => t(time).toISOString();

  it("seulement mes plans en personne à venir où je vais, les plus proches d'abord", () => {
    const views = [
      view("tard", iso("20:00")),
      view("tot", iso("12:00")),
      view("appel", iso("13:00"), { placeId: null }),
      view("refuse", iso("13:00"), { myResponse: "no" }),
      view("pas-invite", iso("13:00"), { invited: false, myResponse: null }),
      view("a-repondre", iso("14:00"), { myResponse: null }),
      view("mien", iso("15:00"), { isMine: true, invited: false, myResponse: null }),
      view("passe", iso("07:00")),
      view("annule", iso("13:00"), { state: "cancelled" }),
    ];
    expect(leaveByTargets(views, NOW).map((x) => x.id)).toEqual([
      "tot",
      "a-repondre",
      "mien",
      "tard",
    ]);
    expect(leaveByTargets(views, NOW, 2).map((x) => x.id)).toEqual(["tot", "a-repondre"]);
  });

  it("withLeaveBy ajoute le résultat aux bons plans seulement", () => {
    const views = [view("a", iso("12:00")), view("b", iso("13:00"))];
    const lb = {
      mode: "car" as const,
      main: "Pars",
      detail: null,
      transit: null,
      warning: null,
      urgent: null,
      note: null,
      leaveAt: null,
      lateMinutes: 0,
    };
    const out = withLeaveBy(views, new Map([["a", lb]]));
    expect(out[0].leaveBy).toBe(lb);
    expect(out[1].leaveBy).toBeUndefined();
  });
});
