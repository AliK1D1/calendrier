/**
 * Apparence de l'app : thème (clair, sombre ou selon l'appareil) et couleur d'accent.
 *
 * Le choix est gardé sur l'appareil (localStorage), pas en base : il s'applique avant même
 * que la page s'affiche (aucun flash blanc en mode sombre) et chacun peut avoir un réglage
 * différent sur son téléphone et son ordinateur. Le script `SCRIPT_APPARENCE`, posé dans le
 * <head>, lit le choix et met `data-theme` et `data-accent` sur <html> ; globals.css fait le
 * reste. Le formulaire du profil écrit le choix puis lance l'événement `EVENEMENT_APPARENCE`
 * pour que le script l'applique tout de suite.
 */

export const THEMES = ["systeme", "clair", "sombre"] as const;
export type ChoixTheme = (typeof THEMES)[number];
export type ThemeEffectif = "clair" | "sombre";

export const THEME_LIBELLES: Record<ChoixTheme, string> = {
  systeme: "Selon l'appareil",
  clair: "Clair",
  sombre: "Sombre",
};

/**
 * Couleurs d'accent (boutons, liens actifs, contour de focus). Seules la teinte et la
 * saturation changent : la clarté reste la même pour toutes, donc le contraste avec le texte
 * des boutons aussi. Les valeurs sont recopiées dans globals.css (`[data-accent=…]`).
 */
export const ACCENTS = [
  { id: "bleu", libelle: "Bleu", teinte: 258, chroma: 0.13 },
  { id: "indigo", libelle: "Indigo", teinte: 285, chroma: 0.15 },
  { id: "rose", libelle: "Rose", teinte: 350, chroma: 0.16 },
  { id: "orange", libelle: "Orange", teinte: 45, chroma: 0.14 },
  { id: "vert", libelle: "Vert", teinte: 155, chroma: 0.12 },
  { id: "sarcelle", libelle: "Sarcelle", teinte: 200, chroma: 0.1 },
  { id: "graphite", libelle: "Graphite", teinte: 260, chroma: 0.02 },
] as const;
export type AccentId = (typeof ACCENTS)[number]["id"];

export const THEME_PAR_DEFAUT: ChoixTheme = "systeme";
export const ACCENT_PAR_DEFAUT: AccentId = "bleu";

export const CLE_THEME = "tlc-theme";
export const CLE_ACCENT = "tlc-accent";
export const EVENEMENT_APPARENCE = "tlc-apparence";

/**
 * Couleur de la barre du navigateur (téléphone), assortie au fond de page. Le script ajoute
 * sa propre balise <meta name="theme-color"> (sans `media`) en tête du <head> : le navigateur
 * prend la première qui correspond, donc elle l'emporte sur celles de Next.js, que React gère
 * et qu'il ne faut pas modifier.
 */
export const ID_META_BARRE = "tlc-couleur-barre";
export const COULEUR_BARRE: Record<ThemeEffectif, string> = {
  clair: "#f8f9fb",
  sombre: "#0f1218",
};

export function lireTheme(valeur: unknown): ChoixTheme {
  return (THEMES as readonly unknown[]).includes(valeur)
    ? (valeur as ChoixTheme)
    : THEME_PAR_DEFAUT;
}

export function lireAccent(valeur: unknown): AccentId {
  return ACCENTS.some((a) => a.id === valeur) ? (valeur as AccentId) : ACCENT_PAR_DEFAUT;
}

/** Thème réellement affiché : « selon l'appareil » suit le réglage du système. */
export function themeEffectif(choix: ChoixTheme, systemeSombre: boolean): ThemeEffectif {
  if (choix === "systeme") return systemeSombre ? "sombre" : "clair";
  return choix;
}

/**
 * Script lancé dans le <head> avant l'affichage. Écrit en JavaScript simple (pas de
 * transpilation) et entièrement dans un try : sans localStorage (navigation privée), on
 * retombe sur « selon l'appareil » et l'accent bleu. Il réapplique le choix quand le système
 * passe en mode sombre, quand un autre onglet change le réglage, et sur `EVENEMENT_APPARENCE`.
 */
export const SCRIPT_APPARENCE = `(function(){try{
var T=${JSON.stringify(THEMES)},A=${JSON.stringify(ACCENTS.map((a) => a.id))};
var d=document.documentElement,m=window.matchMedia("(prefers-color-scheme: dark)");
function lire(k){try{return window.localStorage.getItem(k)}catch(e){return null}}
function appliquer(){
var t=lire(${JSON.stringify(CLE_THEME)}),c=lire(${JSON.stringify(CLE_ACCENT)});
if(T.indexOf(t)<0)t=${JSON.stringify(THEME_PAR_DEFAUT)};
if(A.indexOf(c)<0)c=${JSON.stringify(ACCENT_PAR_DEFAUT)};
var s=t==="sombre"||(t==="systeme"&&m.matches);
d.setAttribute("data-theme",s?"sombre":"clair");
d.setAttribute("data-accent",c);
var b=document.getElementById(${JSON.stringify(ID_META_BARRE)});
if(!b&&document.head){b=document.createElement("meta");b.id=${JSON.stringify(ID_META_BARRE)};b.name="theme-color";document.head.insertBefore(b,document.head.firstChild)}
if(b)b.setAttribute("content",s?${JSON.stringify(COULEUR_BARRE.sombre)}:${JSON.stringify(COULEUR_BARRE.clair)});
}
appliquer();
if(m.addEventListener)m.addEventListener("change",appliquer);
window.addEventListener("storage",appliquer);
window.addEventListener(${JSON.stringify(EVENEMENT_APPARENCE)},appliquer);
}catch(e){}})();`;
