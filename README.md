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
| 3   | Temps de trajet (estimation)   | À faire |
| 4   | Recherche de rencontres        | À faire |
| 5   | Classement des propositions    | À faire |
| 6+  | Base de données, comptes, app… | À faire |

## Notes

- **shadcn/ui** : le registre `ui.shadcn.com` n'était pas joignable depuis l'environnement de
  développement initial (refus du proxy réseau). L'initialisation a donc été faite à la main :
  `components.json`, `src/lib/utils.ts` (`cn`), variables CSS du thème dans
  `src/app/globals.css`, et les composants `Button` et `Card` recopiés depuis la source
  officielle. Sur une machine qui a accès au registre, `npx shadcn@latest add <composant>`
  fonctionne normalement avec cette configuration.
