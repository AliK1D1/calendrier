/** Mes lieux, recherche d'adresse et carte. */
export const places = {
  metaTitle: "Mes lieux · Temps libre commun",
  title: "Mes lieux",
  intro:
    "Ta maison, ton cégep, ton travail… L'app s'en sert pour calculer tes temps de trajet. Les membres de tes groupes voient ces lieux.",
  none: "Aucun lieu pour l'instant",
  count: (n: number) => `${n} ${n >= 2 ? "lieux" : "lieu"}`,
  homeSuffix: (name: string) => `${name} (maison)`,
  renamed: "Lieu renommé.",
  newName: "Nouveau nom",
  seeOnMap: "Voir sur la carte",
  home: "Maison",
  isHome: (name: string) => `« ${name} » est ta maison.`,
  setHome: "Définir comme maison",
  rename: "Renommer",
  confirmDelete: (name: string, isHome: boolean) =>
    `Supprimer « ${name} » ?${isHome ? " C'est ta maison : tu n'auras plus de maison." : ""}`,
  deleted: "Lieu supprimé.",
  addTitle: "Ajouter un lieu",
  addHint:
    "Cherche une adresse ou un nom (ex. « Cégep Édouard-Montpetit »), vérifie le point sur la carte (touche la carte pour le déplacer), puis enregistre.",
  searchLabel: "Adresse ou nom du lieu",
  saved: (name: string) => `« ${name} » est enregistré.`,
  placeName: "Nom du lieu",
  myHome: "C'est ma maison",
  savePlace: "Enregistrer ce lieu",
  search: {
    noConnection: "Pas de connexion. Réessaie.",
    placeholder: "Ex. Cégep Édouard-Montpetit",
    button: "Chercher",
    searching: "Recherche…",
    noResult: "Aucun lieu trouvé. Essaie avec l'adresse complète (numéro, rue, ville).",
    results: "Résultats",
    credit: "Recherche : © les contributeurs d'OpenStreetMap (Nominatim).",
  },
  map: "Carte",
  mapLoading: "Chargement de la carte…",
};
