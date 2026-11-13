import { describe, expect, it } from "vitest";

import {
  ACCENTS,
  CLE_ACCENT,
  CLE_THEME,
  COULEUR_BARRE,
  EVENEMENT_APPARENCE,
  ID_META_BARRE,
  SCRIPT_APPARENCE,
  lireAccent,
  lireTheme,
  themeEffectif,
} from "../apparence";

describe("lireTheme / lireAccent", () => {
  it("garde une valeur connue", () => {
    expect(lireTheme("sombre")).toBe("sombre");
    expect(lireTheme("clair")).toBe("clair");
    expect(lireAccent("vert")).toBe("vert");
  });

  it("retombe sur les valeurs par défaut sinon", () => {
    expect(lireTheme(null)).toBe("systeme");
    expect(lireTheme("dark")).toBe("systeme");
    expect(lireAccent(undefined)).toBe("bleu");
    expect(lireAccent("<script>")).toBe("bleu");
  });
});

describe("themeEffectif", () => {
  it("« selon l'appareil » suit le système", () => {
    expect(themeEffectif("systeme", true)).toBe("sombre");
    expect(themeEffectif("systeme", false)).toBe("clair");
  });

  it("un choix explicite l'emporte sur le système", () => {
    expect(themeEffectif("clair", true)).toBe("clair");
    expect(themeEffectif("sombre", false)).toBe("sombre");
  });
});

describe("ACCENTS", () => {
  it("a des identifiants uniques et le bleu d'origine en premier", () => {
    expect(new Set(ACCENTS.map((a) => a.id)).size).toBe(ACCENTS.length);
    expect(ACCENTS[0]).toMatchObject({ id: "bleu", teinte: 258, chroma: 0.13 });
  });
});

/** Fausse page minimale pour exécuter le script du <head> sans navigateur. */
function faussePage(
  stockage: Record<string, string>,
  systemeSombre: boolean,
  stockageBloque = false,
) {
  const attributs: Record<string, string> = {};
  const metas: { id: string; name: string; content: string }[] = [];
  const ecouteurs: Record<string, (() => void)[]> = {};
  const media = { matches: systemeSombre, ecouteur: null as null | (() => void) };
  const window = {
    matchMedia: () => ({
      get matches() {
        return media.matches;
      },
      addEventListener: (_: string, f: () => void) => {
        media.ecouteur = f;
      },
    }),
    get localStorage() {
      if (stockageBloque) throw new Error("bloqué");
      return { getItem: (k: string) => stockage[k] ?? null };
    },
    addEventListener: (type: string, f: () => void) => {
      (ecouteurs[type] ??= []).push(f);
    },
  };
  const document = {
    documentElement: {
      setAttribute: (k: string, v: string) => {
        attributs[k] = v;
      },
    },
    getElementById: (id: string) => {
      const m = metas.find((x) => x.id === id);
      return m ? { setAttribute: (_: string, v: string) => (m.content = v) } : null;
    },
    createElement: () => {
      const m = { id: "", name: "", content: "" };
      return Object.assign(m, { setAttribute: (_: string, v: string) => (m.content = v) });
    },
    head: {
      firstChild: null,
      insertBefore: (m: { id: string; name: string; content: string }) => {
        metas.push(m);
      },
    },
    addEventListener: () => {},
  };
  new Function("window", "document", SCRIPT_APPARENCE)(window, document);
  return {
    attributs,
    metas,
    media,
    declencher: (type: string) => ecouteurs[type]?.forEach((f) => f()),
  };
}

describe("SCRIPT_APPARENCE", () => {
  it("applique le thème et l'accent enregistrés", () => {
    const p = faussePage({ [CLE_THEME]: "sombre", [CLE_ACCENT]: "rose" }, false);
    expect(p.attributs).toEqual({ "data-theme": "sombre", "data-accent": "rose" });
    expect(p.metas).toHaveLength(1);
    expect(p.metas[0]).toMatchObject({
      id: ID_META_BARRE,
      name: "theme-color",
      content: COULEUR_BARRE.sombre,
    });
  });

  it("suit le système par défaut, et quand il change", () => {
    const p = faussePage({}, true);
    expect(p.attributs).toEqual({ "data-theme": "sombre", "data-accent": "bleu" });
    p.media.matches = false;
    p.media.ecouteur?.();
    expect(p.attributs["data-theme"]).toBe("clair");
    // Une seule balise de couleur de barre, mise à jour (pas une nouvelle à chaque fois).
    expect(p.metas).toHaveLength(1);
    expect(p.metas[0]?.content).toBe(COULEUR_BARRE.clair);
  });

  it("ignore une valeur inconnue (aucune injection dans l'attribut)", () => {
    const p = faussePage({ [CLE_THEME]: "noir", [CLE_ACCENT]: '"><img>' }, false);
    expect(p.attributs).toEqual({ "data-theme": "clair", "data-accent": "bleu" });
  });

  it("fonctionne sans localStorage (navigation privée)", () => {
    const p = faussePage({}, false, true);
    expect(p.attributs).toEqual({ "data-theme": "clair", "data-accent": "bleu" });
  });

  it("réapplique le choix sur l'événement du formulaire", () => {
    const stockage: Record<string, string> = {};
    const p = faussePage(stockage, false);
    stockage[CLE_THEME] = "sombre";
    stockage[CLE_ACCENT] = "graphite";
    p.declencher(EVENEMENT_APPARENCE);
    expect(p.attributs).toEqual({ "data-theme": "sombre", "data-accent": "graphite" });
  });
});
