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
- Supabase (Postgres + Auth) avec `@supabase/ssr`, schéma et migrations avec Drizzle ORM

## Installation

Prérequis : Node.js 22 et npm.

```bash
npm install
```

Puis copier `.env.example` en `.env.local` et y mettre l'URL et la clé « anon » du projet
Supabase (voir ci-dessous). Sans ces variables, l'app compile (`npm run build` passe) et
l'accueil s'affiche, mais la connexion est désactivée et les pages protégées renvoient vers
`/connexion`.

## Base de données et comptes (Supabase)

### 1. Créer le projet

1. Sur <https://supabase.com>, **New project** (région conseillée : Canada (Central)).
2. **Project Settings → API** (ou bouton **Connect**) : copier **Project URL** et la clé
   **anon / public** dans `.env.local` :

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```

   La clé anon peut être publique : ce sont les politiques RLS qui protègent les données.
   Ne jamais mettre la clé `service_role` dans l'app.

### 2. Créer les tables (une seule fois)

Méthode simple, sans mot de passe de BD :

1. Supabase → **SQL Editor** → **New query**.
2. Coller **tout** le contenu de [`supabase/setup.sql`](supabase/setup.sql) → **Run**.
3. Vérifier dans **Table Editor** : 7 tables (`profiles`, `places`, `busy_blocks`, `groups`,
   `group_members`, `meetup_plans`, `plan_votes`), chacune marquée « RLS enabled ».

Le script tourne dans une transaction : en cas d'erreur, rien n'est appliqué. Il est fait
pour une base **vide** (le relancer échoue sur « type already exists »).

Méthode alternative (avancée) : mettre `DATABASE_URL` dans `.env.local` (Supabase → Connect →
« Session pooler », avec le mot de passe de la BD) puis `npm run db:migrate`. **Choisir une
seule méthode** : Drizzle ne sait pas que `setup.sql` a déjà été appliqué à la main.

### 3. Configurer la connexion (Authentication)

Dans le tableau de bord Supabase :

1. **Authentication → URL Configuration**
   - **Site URL** : `http://localhost:3000` (à remplacer par l'adresse Vercel au déploiement).
   - **Redirect URLs** → **Add URL** : `http://localhost:3000/auth/callback` (plus tard aussi
     `https://<ton-site>/auth/callback`).
2. **Authentication → Sign In / Providers → Email** : laisser activé (lien magique). Le
   service de courriel intégré de Supabase est limité à quelques courriels par heure : assez
   pour tester, un SMTP perso sera utile au déploiement.
3. **Google (facultatif)** : Authentication → Sign In / Providers → **Google** → activer, puis
   coller le **Client ID** et le **Client Secret** créés dans Google Cloud Console
   (APIs & Services → Credentials → OAuth client ID → « Web application »). Dans Google,
   l'**Authorized redirect URI** est l'adresse de rappel affichée par Supabase sur cette même
   page (`https://xxxx.supabase.co/auth/v1/callback`), pas celle de l'app.

Le lien magique doit être ouvert **dans le même navigateur** que celui où il a été demandé
(flux PKCE). Pour que ça marche aussi d'un navigateur à l'autre, on peut modifier le modèle
**Authentication → Emails → Magic Link** pour pointer vers
`{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink` : la route
`/auth/callback` gère les deux formes.

### 4. Vérifier

`npm run dev`, aller sur <http://localhost:3000>, **Se connecter**, entrer son courriel,
cliquer le lien reçu : l'accueil affiche « Connecté en tant que … » et un bouton **Se
déconnecter**. Une ligne apparaît dans `profiles` (créée par un trigger à l'inscription).

### Comment c'est construit

| Élément                         | Où                                                                       |
| ------------------------------- | ------------------------------------------------------------------------ |
| Schéma Drizzle (tables, types)  | `src/lib/db/schema.ts`                                                   |
| SQL des tables (généré)         | `drizzle/0000_schema.sql` (`npm run db:generate`, sans connexion)        |
| RLS, triggers, fonctions        | `drizzle/0001_rls_triggers.sql` (écrit à la main)                        |
| Tout en un fichier              | `supabase/setup.sql` (`npm run db:setup-sql`, ne pas modifier à la main) |
| BD → types de `scheduling`      | `src/lib/db/convert.ts` (`toPeople`, `expandBusyBlocks`)                 |
| Clients Supabase, middleware    | `src/lib/supabase/`, `src/middleware.ts`                                 |
| Connexion / retour / sortie     | `/connexion`, `/auth/callback`, `/auth/deconnexion` (POST)               |
| Tests migrations + RLS (PGlite) | `src/lib/db/__tests__/rls.test.ts`                                       |

Après une modification de `schema.ts` : `npm run db:generate` (crée une nouvelle migration et
régénère `supabase/setup.sql`), puis appliquer **seulement la nouvelle migration**
(`drizzle/000N_….sql`) dans le SQL Editor. Un test vérifie que `setup.sql` est à jour.

Règles d'accès (RLS) : chacun voit son profil, ses lieux et son horaire, et ceux des membres
de ses groupes ; il ne modifie que les siens. On entre dans un groupe en le créant (on en
devient admin) ou avec son code d'invitation (fonction `join_group_by_code`) ; l'admin peut
retirer un membre. Les plans sont visibles par le groupe et modifiés par leur créateur ; chacun
gère son propre vote. Les visiteurs non connectés (`anon`) n'ont accès à aucune table.

Horaire en BD : `busy_blocks` stocke des **heures locales** (`start_time`, `end_time`) et des
jours. Bloc hebdomadaire : `weekday` (1 = lundi … 7 = dimanche) + période `valid_from` →
`valid_until` (la session). Bloc ponctuel : `weekday` nul, jour = `valid_from`. Un bloc ne
traverse pas minuit (`end_time` ≤ 24:00). La conversion (`convert.ts`) déplie les blocs
hebdomadaires sur une plage de dates dans le fuseau `America/Toronto` : un cours à 10 h reste
à 10 h après le changement d'heure. Une heure qui n'existe pas (2 h 30 le jour du passage à
l'heure avancée) est décalée à 3 h 30 ; une heure qui existe deux fois (1 h 30 en novembre)
prend la première.

## Commandes

| Commande               | Effet                                                     |
| ---------------------- | --------------------------------------------------------- |
| `npm run dev`          | Serveur de développement sur http://localhost:3000        |
| `npm test`             | Tests Vitest (une passe)                                  |
| `npm run test:watch`   | Tests en mode surveillance                                |
| `npm run lint`         | ESLint puis vérification des types (`tsc`)                |
| `npm run typecheck`    | Vérification des types seulement                          |
| `npm run build`        | Build de production                                       |
| `npm run format`       | Formatage Prettier                                        |
| `npm run db:generate`  | Migration Drizzle + `supabase/setup.sql` (sans connexion) |
| `npm run db:setup-sql` | Régénère seulement `supabase/setup.sql`                   |
| `npm run db:migrate`   | Applique les migrations (requiert `DATABASE_URL`)         |

## État des segments

| #   | Segment                       | État    |
| --- | ----------------------------- | ------- |
| 0   | Mise en place du projet       | Fait    |
| 1   | Types et données de test      | Fait    |
| 2   | Fenêtres libres               | Fait    |
| 3   | Temps de trajet (estimation)  | Fait    |
| 4   | Recherche de rencontres       | Fait    |
| 5   | Classement des propositions   | Fait    |
| 6   | Base de données et comptes    | Fait    |
| 7+  | Lieux, horaire, groupes, app… | À faire |

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

- **Tests de la BD sans Supabase** : `rls.test.ts` applique `supabase/setup.sql` sur un
  Postgres en mémoire ([PGlite](https://pglite.dev)) avec un schéma `auth` minimal
  (`auth.users`, `auth.uid()` lisant `request.jwt.claim.sub`, comme Supabase) et les rôles
  `anon` / `authenticated`, puis vérifie les politiques avec `SET ROLE authenticated`. C'est
  fidèle pour SQL et RLS, mais ce n'est pas Supabase : le service Auth lui-même (courriels,
  Google, cookies) n'est testé qu'à la main (étape 4 ci-dessus).

- **shadcn/ui** : le registre `ui.shadcn.com` n'était pas joignable depuis l'environnement de
  développement initial (refus du proxy réseau). L'initialisation a donc été faite à la main :
  `components.json`, `src/lib/utils.ts` (`cn`), variables CSS du thème dans
  `src/app/globals.css`, et les composants `Button` et `Card` recopiés depuis la source
  officielle. Sur une machine qui a accès au registre, `npx shadcn@latest add <composant>`
  fonctionne normalement avec cette configuration.
