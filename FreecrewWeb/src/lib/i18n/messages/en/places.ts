import type { places as fr } from "../fr/places";

export const places: typeof fr = {
  metaTitle: "My places · Freecrew",
  title: "My places",
  intro:
    "Your home, your college, your job… The app uses them to work out your travel times. Members of your groups can see these places.",
  none: "No places yet",
  count: (n: number) => `${n} ${n === 1 ? "place" : "places"}`,
  homeSuffix: (name: string) => `${name} (home)`,
  renamed: "Place renamed.",
  newName: "New name",
  seeOnMap: "See on the map",
  home: "Home",
  isHome: (name: string) => `“${name}” is now your home.`,
  setHome: "Set as home",
  rename: "Rename",
  confirmDelete: (name: string, isHome: boolean) =>
    `Delete “${name}”?${isHome ? " It's your home: you won't have a home anymore." : ""}`,
  deleted: "Place deleted.",
  addTitle: "Add a place",
  addHint:
    "Search for an address or a name (e.g. “Cégep Édouard-Montpetit”), check the point on the map (tap the map to move it), then save.",
  searchLabel: "Address or name of the place",
  saved: (name: string) => `“${name}” is saved.`,
  placeName: "Place name",
  myHome: "This is my home",
  savePlace: "Save this place",
  search: {
    noConnection: "No connection. Please try again.",
    placeholder: "E.g. Cégep Édouard-Montpetit",
    button: "Search",
    searching: "Searching…",
    noResult: "No place found. Try the full address (number, street, city).",
    results: "Results",
    credit: "Search: © OpenStreetMap contributors (Nominatim).",
  },
  map: "Map",
  mapLoading: "Loading the map…",
};
