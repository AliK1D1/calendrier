# Règles du projet « Temps libre commun »

Le plan complet est dans `docs/plan-projet.md`. Lis-le (au minimum les sections 2, 3, 3 bis et 4
et le segment en cours) avant de commencer une tâche.

## Règles

- **Langue** : l'interface est en français (Québec). Textes, libellés, messages d'erreur : en
  français.
- **Fuseau horaire** : `America/Toronto`. Utiliser `date-fns` et `date-fns-tz` pour tout calcul
  de date ; ne jamais supposer qu'une journée fait 24 h (heure avancée).
- **Logique d'horaire** : toute la logique d'horaire va dans `src/lib/scheduling/`, en
  **fonctions pures** testées, **sans accès BD ni React**. Les dépendances externes (temps de
  trajet, horloge) sont injectées.
- **Tests** : chaque nouvelle fonction de scheduling a des tests Vitest (dans
  `src/lib/scheduling/__tests__/`).
- **Typage** : TypeScript strict, aucun `any`.
- **Avant de dire qu'une tâche est finie** : lancer `npm test`, `npm run lint` (ESLint + `tsc`)
  et `npm run build`, et vérifier qu'ils passent.
- **Secrets** : jamais de clé d'API dans le code ; seulement dans `.env.local` (non commité).
  `.env.example` documente les variables.
- **Base de données** : schéma dans `src/lib/db/schema.ts` ; RLS/triggers dans
  `drizzle/0001_rls_triggers.sql` (ou une nouvelle migration `--custom`). Après un changement :
  `npm run db:generate` (régénère `supabase/setup.sql`). Toute nouvelle table a RLS activé et
  des tests dans `src/lib/db/__tests__/rls.test.ts` (PGlite). L'app lit la BD avec supabase-js
  (session de l'utilisateur, donc RLS), jamais avec la clé `service_role`.
- **Commits** : un segment = un commit, message `Segment N : ...`.

## Commandes

- `npm run dev` : serveur de développement (http://localhost:3000)
- `npm test` : tests Vitest
- `npm run lint` : ESLint + vérification des types
- `npm run build` : build de production
- `npm run format` : Prettier
