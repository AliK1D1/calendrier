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
3. Vérifier dans **Table Editor** : 10 tables (`profiles`, `places`, `busy_blocks`, `groups`,
   `group_members`, `meetup_plans`, `plan_invitees`, `plan_votes`, `deadlines`,
   `study_preferences`), chacune marquée « RLS enabled ».

Le script tourne dans une transaction : en cas d'erreur, rien n'est appliqué. Il est fait
pour une base **vide** (le relancer échoue sur « type already exists »).

**Base déjà créée avec un ancien `setup.sql`** (ex. celui du segment 6) : ne pas relancer
`setup.sql`. Coller plutôt, **dans l'ordre et une seule fois chacun**, les migrations qui
manquent, chacune dans une nouvelle requête du SQL Editor :

| Fichier                       | Contenu                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `supabase/migration-0002.sql` | Revue sécurité du segment 6 (droits par colonne, EXECUTE retiré à anon)                           |
| `supabase/migration-0003.sql` | Segment 7 : `profiles.onboarded_at`, nom de lieu ≤ 100 caractères, fonction `complete_onboarding` |
| `supabase/migration-0004.sql` | Segment 8 : `profiles.unavailable_before` / `unavailable_after` (heures où je ne sors pas)        |
| `supabase/migration-0005.sql` | Revue du segment 8 : limites des formulaires appliquées aussi par la BD                           |
| `supabase/migration-0006.sql` | Segment 10 : groupes (confidentialité de l'horaire, lieux du groupe, code d'invitation, départs)  |
| `supabase/migration-0007.sql` | Revue du segment 10 : nouveau lien d'invitation quand un admin retire un membre                   |
| `supabase/migration-0008.sql` | Revue du segment 11 : nombre maximal de lieux et de blocs                                         |
| `supabase/migration-0009.sql` | Segment 12 : proposer un moment au groupe (invités, réponses, blocs « plan » dans l'horaire)      |
| `supabase/migration-0010.sql` | Revue du segment 12 : caractères de contrôle refusés, titre d'un plan gardé dans son groupe       |
| `supabase/migration-0011.sql` | Segments 13-14 : examens et travaux, séances d'étude dans l'horaire, préférences d'étude          |

Chaque fichier est dans une transaction et échoue sans rien changer s'il a déjà été appliqué
(« already exists »).

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
régénère `supabase/setup.sql` et les fichiers `supabase/migration-000N.sql`), puis coller
**seulement le nouveau** `supabase/migration-000N.sql` dans le SQL Editor. Des tests vérifient
que ces fichiers sont à jour et qu'ils s'appliquent sur une base qui a l'ancien `setup.sql`.

Règles d'accès (RLS) : chacun voit son profil, ses lieux et son horaire, et ceux des membres
de ses groupes ; il ne modifie que les siens. On entre dans un groupe en le créant (on en
devient admin) ou avec son code d'invitation (fonction `join_group_by_code`) ; l'admin peut
retirer un membre. Les plans sont visibles par le groupe ; on ne les écrit que par les fonctions
`propose_meetup`, `respond_to_meetup` et `cancel_meetup` (segment 12). Les visiteurs non connectés (`anon`) n'ont accès à aucune table.

Horaire en BD : `busy_blocks` stocke des **heures locales** (`start_time`, `end_time`) et des
jours. Bloc hebdomadaire : `weekday` (1 = lundi … 7 = dimanche) + période `valid_from` →
`valid_until` (la session). Bloc ponctuel : `weekday` nul, jour = `valid_from`. Un bloc ne
traverse pas minuit (`end_time` ≤ 24:00). La conversion (`convert.ts`) déplie les blocs
hebdomadaires sur une plage de dates dans le fuseau `America/Toronto` : un cours à 10 h reste
à 10 h après le changement d'heure. Une heure qui n'existe pas (2 h 30 le jour du passage à
l'heure avancée) est décalée à 3 h 30 ; une heure qui existe deux fois (1 h 30 en novembre)
prend la première.

## Mes lieux, profil et accueil (segment 7)

| Page / élément     | Rôle                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `/bienvenue`       | Accueil de première connexion : maison, cégep ou école (facultatif), mode de transport      |
| `/lieux`           | Mes lieux : ajouter (recherche d'adresse + carte), renommer, supprimer, choisir la maison   |
| `/profil`          | Nom affiché et mode de transport                                                            |
| `/api/geocode?q=…` | Recherche d'adresse côté serveur (Nominatim), réservée aux personnes connectées (sinon 401) |

- **Première connexion** : après `/auth/callback`, une personne dont `profiles.onboarded_at`
  est vide passe par `/bienvenue` (puis va à la page demandée). L'accueil est enregistré en une
  transaction par la fonction SQL `complete_onboarding` (RLS appliquée ; un double envoi ne
  crée pas de lieux en double). « Plus tard » marque l'accueil comme fait sans lieu. Si la
  migration 0003 n'est pas appliquée, la connexion continue de marcher sans accueil.
- **Géocodage** (`src/lib/geocoding/`, fonctions pures testées) : Nominatim d'OpenStreetMap,
  appelé **seulement par le serveur**, avec le User-Agent `TempsLibreCommun/0.1 (projet
étudiant)`, au plus **1 requête/s** pour toute l'app (file d'attente de 10, au-delà : « service
  occupé »), cache de 24 h (500 recherches), recherche seulement quand on appuie sur
  « Chercher » (pas à chaque touche). Les arrêts d'autobus et stations de vélos qui portent le
  nom cherché sont placés après le vrai lieu. `NOMINATIM_EMAIL` (facultatif) est envoyé comme
  contact.
- **Carte** : Leaflet + tuiles OpenStreetMap, chargée seulement dans le navigateur
  (`next/dynamic`, `ssr: false`). Toucher la carte déplace le point avant d'enregistrer.
- **Validation** (`src/lib/places/validation.ts`) : nom 1 à 100 caractères, coordonnées
  valides arrondies à 6 décimales, mode de transport connu. Les actions serveur valident tout,
  puis écrivent avec le client Supabase de la session (RLS).
- **Derrière un proxy** (réseau d'entreprise, bac à sable) : le `fetch` de Node ignore
  `HTTPS_PROXY` ; lancer avec `NODE_USE_ENV_PROXY=1 npm run dev`.

## Mon horaire (segment 8)

| Page / élément | Rôle                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------- |
| `/horaire`     | Grille lundi → dimanche, 7 h → 23 h par 15 min ; ajouter, modifier, supprimer des blocs     |
| `/profil`      | « Heures où je ne sors pas » (ex. pas avant 9 h, pas après 22 h), en plus du nom et du mode |

- **Ajouter** : clic-glisser sur la grille (ordinateur) ou toucher une case (téléphone : un jour
  à la fois, avec des onglets), ou bouton « Ajouter un bloc ». Formulaire : titre, lieu (mes
  lieux ; « Maison » par défaut si aucun), début/fin, « Chaque semaine » (on coche tous les jours
  du cours d'un coup : un bloc par jour) ou « Une seule fois », dates de début et de fin de
  session. La session proposée est celle de mes cours déjà entrés, sinon la session de cégep en
  cours ou à venir. Les blocs sont enregistrés dans `busy_blocks` avec `source = 'manual'`.
- **Récurrence** : un bloc hebdomadaire revient chaque semaine entre `valid_from` et
  `valid_until` (inclus), et plus après. Les flèches changent de semaine.
- **Chevauchements** : permis (un examen pendant un cours…), mais le formulaire les signale.
- **Heures où je ne sors pas** : stockées dans `profiles` (migration 0004), hachurées sur la
  grille et transformées en blocs occupés à la maison par `toPeople` (`quietHoursBlocks`), un
  par jour, en heure locale (le jour du changement d'heure, « avant 9 h » dure 10 h ou 8 h).
- Logique pure et testée dans `src/lib/scheduling/` : `weeklyBlocks.ts` (validation du
  formulaire, récurrence, chevauchements, semaines, session proposée), `weekGrid.ts` (position
  des blocs, colonnes côte à côte, clic-glisser), `quietHours.ts`. Conversion BD ↔ formulaire :
  `toBlockSpec` / `fromBlockSpec` dans `src/lib/db/convert.ts`.

## Import d'horaire .ics (segment 9)

Dans `/horaire`, bouton **« Importer un fichier .ics »** (exporté de Google Agenda, Outlook ou
d'une plateforme scolaire). Aucune migration de BD n'est nécessaire.

1. **Téléverser** le fichier (1 Mo au maximum). Une action serveur le lit et renvoie un
   **aperçu** : rien n'est écrit dans la BD à cette étape (elle compte seulement les blocs déjà
   importés).
2. **Aperçu** : blocs détectés (chaque semaine / une seule fois), remarques (journées
   entières, événements annulés ou « disponibles » ignorés, titres raccourcis…). Chaque texte
   « LOCATION » distinct est associé à un de mes lieux (proposé si le nom correspond) ou à un
   **nouveau lieu** (nom + recherche d'adresse). On peut décocher des blocs.
3. **Confirmer** : création des nouveaux lieux, insertion de tous les blocs
   (`source = 'ics'`, une seule requête : tout ou rien), puis suppression des anciens blocs
   `ics` de la personne créés avant. Un ré-import **remplace** donc l'import précédent sans
   doublon ; les blocs ajoutés à la main ne changent pas. Si l'insertion échoue, l'ancien
   horaire reste intact.

Lecture du fichier (`src/lib/import/ics.ts`, fonction pure `parseIcs`, avec ical.js) :

- **Récurrences** : RRULE `WEEKLY`/`DAILY` (BYDAY, INTERVAL, UNTIL, COUNT), `MONTHLY`/`YEARLY`
  simples, RDATE, EXDATE, exceptions RECURRENCE-ID (occurrence déplacée ou annulée). Les autres
  règles sont ignorées avec une remarque (pas de boucle infinie).
- **Fuseaux** : TZID (IANA, préfixe Mozilla, noms Windows courants), heures UTC (« Z ») et
  heures flottantes (lues à l'heure du Québec). La récurrence est calculée en heure murale du
  TZID : un cours à 10 h reste à 10 h après le changement d'heure. Un horaire écrit en UTC se
  décale d'une heure en heure locale (deux blocs).
- **Vers `busy_blocks`** : les occurrences identiques (titre, lieu, jour, heures) qui se suivent
  chaque semaine deviennent un bloc hebdomadaire `weekday` + `valid_from`/`valid_until`. Une
  semaine sautée (semaine de relâche exclue par EXDATE) coupe la série en **deux blocs** :
  c'est la représentation exacte (un bloc unique rendrait la relâche occupée). Une occurrence
  isolée devient un bloc ponctuel ; une occurrence de nuit est coupée à minuit.
- **Limites** : 1 Mo, 1000 événements, 5000 occurrences, 300 blocs ; seules les occurrences
  d'aujourd'hui à dans un an sont gardées (période d'un bloc < 366 jours, comme l'exige la
  migration 0005) ; titre raccourci à 100 caractères avec « … » (signalé dans l'aperçu).
- Tests : `src/lib/import/__tests__/` (fichier d'exemple `fixtures/horaire-hiver-2027.ics` :
  cours hebdomadaires, semaine de relâche exclue, changement d'heure, exception, UTC) et
  `src/lib/db/__tests__/rls.test.ts` (remplacement sur PGlite, RLS, tout ou rien).

## Groupes et amis (segment 10)

**Migration à appliquer : `supabase/migration-0006.sql`** (SQL Editor, une seule fois). Les
anciens codes d'invitation (12 caractères) sont remplacés par des codes de 32 caractères.

- **`/groupes`** : mes groupes (nombre de membres, rôle), créer un groupe (fonction
  `create_group` : le créateur devient admin), coller un lien ou un code reçu.
- **`/groupes/[id]`** (membres seulement ; sinon 404, même si le groupe existe) : lien
  d'invitation à copier ou partager, **Nouveau lien** pour l'admin (`regenerate_invite_code` :
  l'ancien lien cesse de marcher), membres, **Retirer** (admin), **Quitter**, lieux favoris du
  groupe (recherche d'adresse + carte), et quand chacun est occupé (semaine type).
- **`/rejoindre/[code]`** : si on n'est pas connecté, le middleware envoie vers
  `/connexion?next=/rejoindre/<code>` puis ramène ici (après l'accueil de première connexion
  s'il y a lieu). La page montre le nom du groupe (`group_invite_preview`) et demande de
  **confirmer** : ouvrir un lien ne suffit pas à faire entrer quelqu'un dans un groupe.
- **Confidentialité** (`/profil`, activée par défaut, `profiles.hide_block_titles`) : les
  membres voient « Occupé », l'heure et le lieu, pas le titre. C'est la **base** qui l'applique :
  `busy_blocks` n'est plus lisible que par son propriétaire (même par l'API REST avec la clé
  anon) ; l'horaire des autres passe par la fonction `group_busy_blocks(gid)` (SECURITY
  DEFINER, membres du groupe seulement), qui masque le titre.
- **Lieux du groupe** : `places.group_id` + `is_group_favorite` (vont ensemble, contrainte).
  Visibles et ajoutables seulement par les membres du groupe (pas par ceux qui partagent un
  autre groupe avec l'auteur) ; on ne peut rattacher un lieu qu'à un groupe dont on est membre ;
  l'auteur ou un admin le supprime. Ils n'apparaissent pas dans « Mes lieux ».
- **Départs** : un membre se retire, l'admin retire un autre membre. Si le dernier admin part,
  le membre le plus ancien devient admin ; si le dernier membre part, le groupe est supprimé
  (avec ses lieux et ses plans). Rétrograder le dernier admin est refusé.
- Les visiteurs non connectés (`anon`) ne peuvent exécuter aucune fonction (EXECUTE retiré
  explicitement : Supabase le donne par défaut aux nouvelles fonctions).
- Tests : `src/lib/db/__tests__/rls.test.ts` (PGlite, comptes A et B + C hors groupe, requêtes
  directes sur les tables comme par l'API REST, migration 0006 sur une base en 0005 avec des
  données) et `src/lib/groups/__tests__/`.

## Quand on peut se voir (segment 11)

**Migration à appliquer : aucune** (tout passe par les tables et fonctions de la 0006).

- En haut de **`/groupes/[id]`** : choisir qui participe (au moins deux), la période (**cette
  semaine** = d'aujourd'hui à dimanche, ou **la semaine prochaine**), la durée minimale (30, 45,
  60, 90 ou 120 min) et la marge par trajet (0 à 30 min, 5 par défaut).
- L'action serveur `chercherMoments` (`src/app/groupes/meetup-actions.ts`) valide la demande
  (`validateMeetupSearch`), puis lit avec **le jeton de la personne connectée** (RLS, jamais de
  clé service) : membres du groupe, profils (mode de transport, maison, heures « je ne sors
  pas »), lieux personnels des participants, lieux favoris du groupe, et l'horaire des membres
  **uniquement par `group_busy_blocks(gid)`**. Un non-membre est refusé (« Groupe
  introuvable ») ; un participant qui n'est pas membre aussi. La logique
  (`src/lib/meetups/search.ts`) convertit avec `toPeople`, appelle `findMeetups` avec
  `EstimatedTravelProvider` (au plus 5 propositions par jour, rien avant maintenant arrondi au
  quart d'heure) et met en forme les cartes : jour, heures, lieu, durée, trajet de chacun
  (« ali : 0 min, Sam : 12 min », retour indiqué s'il diffère).
- **Rien de possible en personne** : message clair et l'appel proposé (« Pas de moment
  réaliste en personne sur cette période, voici un appel possible lundi 15 septembre à 10 h »).
- **Vue grille** (bouton « Grille ») : par demi-heure de 8 h à 22 h, combien de participants
  sont libres (sans les trajets ; les noms au survol).
- **Lieu non visible** : un bloc peut pointer vers un lieu que la RLS cache (favori d'un
  _autre_ groupe de ce membre, ou lieu supprimé). Le bloc compte quand même comme occupé, mais
  on suppose que la personne est **à sa maison** pendant ce bloc ; ce lieu n'est jamais proposé
  et l'interface indique combien de blocs sont concernés. Un participant sans maison visible
  est écarté du calcul, avec la raison affichée.
- Tests : `src/lib/db/__tests__/meetups.test.ts` (PGlite : fixtures du segment 4 écrites en
  BD puis relues sous RLS ; mêmes propositions que `findMeetups` sur les fixtures ; cas « pause
  de 1 h au cégep, ami à 40 min » ; non-membre refusé ; lieu non visible ; temps de calcul
  pour 5 personnes sur une semaine, environ 40 ms lecture comprise).

## Proposer un moment au groupe (segment 12)

**Migration à appliquer : `supabase/migration-0009.sql`** (SQL Editor, une seule fois).

- **Proposer** : dans `/groupes/[id]`, bouton **« Proposer ce moment »** sur chaque carte de
  « Quand on peut se voir » (jour, heures, lieu et participants repris de la carte), ou
  **« Proposer un moment »** (jour, heure, durée de 15 min à 12 h, lieu favori du groupe ou lieu
  écrit à la main). On invite **tout le groupe** ou **certaines personnes**. Le proposant est
  inscrit d'office (le moment s'ajoute à son horaire).
- **Notification dans l'app** (pas de courriel : le service de Supabase est limité à quelques
  courriels par heure ; pas de notification poussée pour l'instant) : tous les membres voient la
  proposition dans la section **Propositions** du groupe et dans **`/plans`** ; le lien
  **Plans** de l'en-tête porte une pastille avec le nombre de plans qui attendent ma réponse.
- **Répondre** : les invités **acceptent** ou **refusent**, et peuvent changer d'avis tant que
  le plan n'est pas fini. Les membres non invités voient le plan pour info, sans boutons. Le
  proposant peut **annuler** (le plan reste visible, barré, dans « Passés et annulés »).
- **Horaire** : accepter ajoute un bloc ponctuel `source = 'meetup'` (colonne
  `busy_blocks.meetup_plan_id`) à **mon** horaire, même s'il chevauche autre chose ; refuser,
  annuler ou quitter le groupe le retire. Il apparaît dans `/horaire` (couleur du thème, badge
  « plan de groupe », en lecture seule : « Voir le plan »), compte comme occupé dans « Quand on
  peut se voir » et reste « Occupé » pour les autres membres (confidentialité de la 0006).
- **`/plans`** : en attente de ma réponse, à venir (acceptés ou proposés par moi), autres plans de
  mes groupes (refusés ou sans invitation), passés et annulés (60 derniers jours).
  **« Ajouter à mon agenda »** télécharge un `.ics` (`/plans/[id]/ics`, seulement pour un plan
  accepté ou proposé par moi).
- **Sécurité (BD)** : plus aucune écriture directe dans `meetup_plans`, `plan_votes` et
  `plan_invitees` (droits retirés, politiques d'écriture supprimées) ; tout passe par
  `propose_meetup`, `respond_to_meetup` et `cancel_meetup` (SECURITY DEFINER, `search_path`
  vide, EXECUTE retiré à `anon`), qui vérifient : membre du groupe, invités tous membres, seul un
  invité répond et pour lui-même, seul le créateur annule, lieu d'un membre ou favori de ce
  groupe. Le bloc est créé par la fonction interne `add_meetup_block` (non appelable). Sur
  `busy_blocks`, `meetup_plan_id` n'est pas modifiable (droits par colonne) et un bloc de plan ne
  se modifie ni ne se supprime directement. Limites : titre ≤ 80 caractères, lieu écrit
  ≤ 100, durée 15 min à 12 h, dans l'année qui vient, fin au plus tard à minuit, 10 propositions
  par personne et par groupe en 24 h, 30 par groupe en 24 h, 50 plans à venir par groupe. La
  limite de 1000 blocs (0008) s'applique : accepter avec un horaire plein donne un message clair.
- **Pas fait** : la revalidation « à revoir » (plan devenu impossible après un changement
  d'horaire) ; le statut `confirmed` n'est pas utilisé (chaque invité répond pour lui-même) ;
  une personne qui rejoint le groupe après une proposition « tout le groupe » la voit mais n'est
  pas invitée.
- Tests : `src/lib/db/__tests__/plans.test.ts` (PGlite, requêtes directes comme par l'API REST,
  y compris la migration 0009 sur une base en 0008 avec des données) et
  `src/lib/plans/__tests__/` (validation, mise en forme, `.ics`).

## Planificateur d'étude : la logique (segment 13)

**Migration à appliquer : `supabase/migration-0011.sql`** (SQL Editor, une seule fois).

- **`src/lib/scheduling/studyPlanner.ts`** (fonctions pures, testées) :
  `planStudySessions(person, deadlines, prefs, travelProvider, now, options)` renvoie
  `{ sessions, warnings }` (types `Deadline`, `StudySession`, `StudyPreferences` dans `types.ts`).
  - **Réalisme** : une séance a lieu là où la personne est déjà (lieu du bloc d'avant ou d'après,
    ex. le cégep entre deux cours) ou à la maison, jamais ailleurs ; si la fenêtre implique de
    changer de lieu, le trajet et la marge sont retirés avec le même calcul que `findMeetups`
    (`availabilityInWindow`). `options.studyPlaceIds` limite les lieux (l'app : mes lieux, pas
    le café d'un plan de groupe).
  - **Heures nécessaires** : l'estimation, sinon 3 h, 5 h ou 8 h selon la difficulté (1 à 3).
  - **Répartition** : une courte révision (durée minimale) la veille, avant l'heure limite du
    soir ; le reste étalé sur les 14 jours d'avant avec plus de poids 2-3 jours avant, puis 4-5
    jours avant ; le matin même en dernier recours ; la veille au plus la moitié des heures
    (jamais tout la veille). Échéances traitées de la plus proche à la plus lointaine (puis la
    plus lourde) ; chacune a sa révision avant que les autres se servent.
  - **Limites** : séances de 45 min à 2 h par défaut (pas de 15 min), 3 h par jour au plus
    (séances acceptées comprises), pause entre deux séances, heures d'étude (8 h à 22 h), 30 %
    du temps libre des soirées (après 18 h) et des fins de semaine gardé libre.
  - **Avertissements** : « Il te manque 2 h avant l'examen de chimie. » plutôt que de surcharger ;
    échéance passée : rien ; aujourd'hui : au plus une courte révision.
  - `checkStudySession` revalide une séance (déplacée à la main) avant de l'enregistrer ;
    `findStudyConflicts` trouve les séances acceptées et déplaçables sur lesquelles tombe autre
    chose (plan de groupe, cours, trajet devenu impossible) ; `rescheduleStudySessions` les
    replace au moment libre le plus proche avant l'échéance.
- **BD (migration 0011)** :
  - Table **`deadlines`** (`kind` examen/travail, `course`, `due_at`, `estimated_hours`,
    `difficulty`) : visible et modifiable **seulement par son propriétaire** (RLS, anon refusé).
    Limites : nom du cours 1 à 80 caractères sur une ligne, heures estimées 0,5 à 60 (par
    demi-heure), difficulté 1 à 3, date dans l'année qui vient (revérifiée seulement si elle
    change), 100 échéances par personne.
  - **`busy_blocks`** : `source = 'study'` avec `deadline_id` (toujours une échéance de la même
    personne : trigger `check_block_deadline_owner`, même en contournant la RLS) et `movable`.
    Une séance est ponctuelle ; seul un bloc d'étude est déplaçable ; `deadline_id` ne se
    modifie pas. Supprimer une échéance retire ses séances. La limite de 1000 blocs s'applique.
  - **Confidentialité** : dans l'horaire du groupe (`group_busy_blocks`), une séance d'étude est
    toujours « Occupé » (le titre contient le nom du cours), même si la personne montre ses
    titres.
  - Table **`study_preferences`** (une ligne par personne, seulement la sienne, bornes en BD).
- Les séances **proposées** ne sont jamais écrites : seules les séances acceptées deviennent des
  blocs (segment 14).
- Tests : `src/lib/scheduling/__tests__/studyPlanner.test.ts` (cas limites de la section 3 bis,
  maximum par jour, durées, horaires aléatoires vérifiés sans chevauchement ni trajet impossible)
  et `src/lib/db/__tests__/study.test.ts` (PGlite : RLS par requêtes directes, anon refusé,
  limites, échéance d'un autre refusée, confidentialité, migration 0011 sur une base en 0010 avec
  des blocs « plan » et un plan).

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

| #   | Segment                            | État    |
| --- | ---------------------------------- | ------- |
| 0   | Mise en place du projet            | Fait    |
| 1   | Types et données de test           | Fait    |
| 2   | Fenêtres libres                    | Fait    |
| 3   | Temps de trajet (estimation)       | Fait    |
| 4   | Recherche de rencontres            | Fait    |
| 5   | Classement des propositions        | Fait    |
| 6   | Base de données et comptes         | Fait    |
| 7   | Mes lieux                          | Fait    |
| 8   | Mon horaire (saisie manuelle)      | Fait    |
| 9   | Import d'horaire .ics              | Fait    |
| 10  | Groupes et amis                    | Fait    |
| 11  | Vue « quand on peut se voir »      | Fait    |
| 12  | Proposer un moment au groupe       | Fait    |
| 13  | Planificateur d'étude : logique    | Fait    |
| 14+ | Planificateur d'étude : interface… | À faire |

## Le cœur : `src/lib/scheduling/`

Logique pure (sans BD ni React), entièrement testée avec Vitest (`__tests__/`).

| Fichier           | Rôle                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `types.ts`        | Vocabulaire : `Place`, `BusyBlock`, `Person`, `FreeWindow`, `MeetupRequest`, `MeetupProposal`… |
| `time.ts`         | Heures locales `America/Toronto` (heure avancée comprise), jours `yyyy-MM-dd`                  |
| `freeWindows.ts`  | `getFreeWindows(person, dayStart, dayEnd, options)` : trous libres + lieu avant/après          |
| `travel.ts`       | `TravelTimeProvider` et `EstimatedTravelProvider` (haversine × 1,3, vitesse par mode, cache)   |
| `findMeetups.ts`  | `findMeetupCandidates` (algorithme de la section 3) et `findMeetups` (classé, appels)          |
| `score.ts`        | `scoreProposal(p, weights)` et `DEFAULT_WEIGHTS`                                               |
| `weeklyBlocks.ts` | Horaire saisi : validation, récurrence hebdomadaire, chevauchements, semaines                  |
| `weekGrid.ts`     | Mise en page de la grille de /horaire (colonnes côte à côte, clic-glisser)                     |
| `quietHours.ts`   | Heures où je ne sors pas → blocs occupés à la maison                                           |
| `studyPlanner.ts` | `planStudySessions` : séances d'étude réalistes avant un examen ou un travail (section 3 bis)  |

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
