# Temps libre commun

Application web où des amis entrent leurs horaires (cours, travail…) et leurs lieux habituels,
et qui leur propose **des moments ET des endroits** où se voir qui sont vraiment faisables :
temps de trajet, durée minimale de rencontre et lieu où chacun se trouve avant et après.

Le plan complet du projet est dans [`docs/plan-projet.md`](docs/plan-projet.md) et les règles
de travail dans [`CLAUDE.md`](CLAUDE.md).

## Pile technique

- Next.js 15 (App Router) + TypeScript strict
- Tailwind CSS 4 + shadcn/ui (style « new-york », composants dans `src/components/ui`)
- Vitest pour les tests, ESLint + Prettier
- date-fns + date-fns-tz (fuseau `America/Toronto`)

## Installation

Prérequis : Node.js 22 et npm.

```bash
npm install
```

Aucune variable d'environnement n'est nécessaire pour les segments 0 à 5 (voir `.env.example`).

## Commandes

| Commande             | Effet                                              |
| -------------------- | -------------------------------------------------- |
| `npm run dev`        | Serveur de développement sur http://localhost:3000 |
| `npm test`           | Tests Vitest (une passe)                           |
| `npm run test:watch` | Tests en mode surveillance                         |
| `npm run lint`       | ESLint puis vérification des types (`tsc`)         |
| `npm run typecheck`  | Vérification des types seulement                   |
| `npm run build`      | Build de production                                |
| `npm run format`     | Formatage Prettier                                 |

## État des segments

| #   | Segment                        | État    |
| --- | ------------------------------ | ------- |
| 0   | Mise en place du projet        | Fait    |
| 1   | Types et données de test       | Fait    |
| 2   | Fenêtres libres                | Fait    |
| 3   | Temps de trajet (estimation)   | Fait    |
| 4   | Recherche de rencontres        | Fait    |
| 5   | Classement des propositions    | Fait    |
| 6+  | Base de données, comptes, app… | À faire |

## Le cœur : `src/lib/scheduling/`

Logique pure (sans BD ni React), entièrement testée avec Vitest (`__tests__/`).

| Fichier          | Rôle                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `types.ts`       | Vocabulaire : `Place`, `BusyBlock`, `Person`, `FreeWindow`, `MeetupRequest`, `MeetupProposal`… |
| `time.ts`        | Heures locales `America/Toronto` (heure avancée comprise), jours `yyyy-MM-dd`                  |
| `freeWindows.ts` | `getFreeWindows(person, dayStart, dayEnd, options)` : trous libres + lieu avant/après          |
| `travel.ts`      | `TravelTimeProvider` et `EstimatedTravelProvider` (haversine × 1,3, vitesse par mode, cache)   |
| `findMeetups.ts` | `findMeetupCandidates` (algorithme de la section 3) et `findMeetups` (classé, appels)          |
| `score.ts`       | `scoreProposal(p, weights)` et `DEFAULT_WEIGHTS`                                               |

Exemple :

```ts
import { findMeetups } from "@/lib/scheduling/findMeetups";
import { EstimatedTravelProvider } from "@/lib/scheduling/travel";

const propositions = await findMeetups(
  personnes,
  {
    personIds: ["ali", "sam"],
    dates: { from: "2025-09-15", to: "2025-09-21" },
    minDurationMinutes: 45,
    bufferMinutes: 5,
    favoritePlaces: favorisDuGroupe,
  },
  new EstimatedTravelProvider(),
  { maxPerDay: 3 },
);
```

### Choix d'implémentation à connaître

- **Marge** : ajoutée à chaque trajet réel. Si la personne est déjà au lieu de rencontre
  (trajet de 0 min), pas de trajet, donc pas de marge : deux amis au même cégep peuvent profiter
  de toute leur pause commune.
- **Heures de la journée** : par défaut 8 h → 22 h (`MeetupRequest.dayHours`). En dehors, la
  personne est considérée comme indisponible ; la première et la dernière fenêtre de la journée
  partent de / reviennent à la maison.
- **Blocs qui se chevauchent** : toujours fusionnés ; on arrive au lieu du premier bloc et on
  repart du lieu du bloc qui finit le plus tard. `mergeGapMinutes` fusionne aussi les petits trous.
- **Propositions** : un créneau = l'intervalle commun complet (ex. 12 h → 12 h 30), pas une
  rencontre découpée. Le score plafonne la durée utile à 3 h.
- **Doublons** : deux propositions sont « au même lieu » si elles ont le même identifiant de lieu
  ou des coordonnées à moins de 50 m (utile quand deux amis ont chacun enregistré leur cégep).
- **Appel/visio** : `kind: "call"`, `placeId: null`, trajets à 0 ; proposé seulement les jours
  sans aucune rencontre en personne possible.

## Notes

- **shadcn/ui** : le registre `ui.shadcn.com` n'était pas joignable depuis l'environnement de
  développement initial (refus du proxy réseau). L'initialisation a donc été faite à la main :
  `components.json`, `src/lib/utils.ts` (`cn`), variables CSS du thème dans
  `src/app/globals.css`, et les composants `Button` et `Card` recopiés depuis la source
  officielle. Sur une machine qui a accès au registre, `npx shadcn@latest add <composant>`
  fonctionne normalement avec cette configuration.
