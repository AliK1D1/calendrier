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
3. Vérifier dans **Table Editor** : 11 tables (`profiles`, `places`, `busy_blocks`, `groups`,
   `group_members`, `meetup_plans`, `plan_invitees`, `plan_votes`, `deadlines`,
   `study_preferences`, `availability_slots`), chacune marquée « RLS enabled ».

Le script tourne dans une transaction : en cas d'erreur, rien n'est appliqué. Il est fait
pour une base **vide** (le relancer échoue sur « type already exists »).

**Base déjà créée avec un ancien `setup.sql`** (ex. celui du segment 6) : ne pas relancer
`setup.sql`. Coller plutôt, **dans l'ordre et une seule fois chacun**, les migrations qui
manquent, chacune dans une nouvelle requête du SQL Editor :

| Fichier                       | Contenu                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `supabase/migration-0002.sql` | Revue sécurité du segment 6 (droits par colonne, EXECUTE retiré à anon)                                |
| `supabase/migration-0003.sql` | Segment 7 : `profiles.onboarded_at`, nom de lieu ≤ 100 caractères, fonction `complete_onboarding`      |
| `supabase/migration-0004.sql` | Segment 8 : `profiles.unavailable_before` / `unavailable_after` (heures où je ne sors pas)             |
| `supabase/migration-0005.sql` | Revue du segment 8 : limites des formulaires appliquées aussi par la BD                                |
| `supabase/migration-0006.sql` | Segment 10 : groupes (confidentialité de l'horaire, lieux du groupe, code d'invitation, départs)       |
| `supabase/migration-0007.sql` | Revue du segment 10 : nouveau lien d'invitation quand un admin retire un membre                        |
| `supabase/migration-0008.sql` | Revue du segment 11 : nombre maximal de lieux et de blocs                                              |
| `supabase/migration-0009.sql` | Segment 12 : proposer un moment au groupe (invités, réponses, blocs « plan » dans l'horaire)           |
| `supabase/migration-0010.sql` | Revue du segment 12 : caractères de contrôle refusés, titre d'un plan gardé dans son groupe            |
| `supabase/migration-0011.sql` | Segments 13-14 : examens et travaux, séances d'étude dans l'horaire, préférences d'étude               |
| `supabase/migration-0012.sql` | Segment 18 : disponibilités ponctuelles (table `availability_slots`, `group_availability_slots`)       |
| `supabase/migration-0017.sql` | Story 3 : calendriers en ligne abonnés (`calendar_subscriptions`, `subscription_events`)               |
| `supabase/migration-0021.sql` | Cours annulé cette fois-ci : `busy_blocks.skip_days`, renvoyé aussi par `group_busy_blocks`            |
| `supabase/migration-0022.sql` | Limite de sorties : `profiles.max_outings_per_day` / `_per_week`, `is_outing` dans `group_busy_blocks` |

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
2. **Authentication → Sign In / Providers → Email** : laisser le fournisseur activé, mais
   **désactiver « Confirm email »**. Les comptes se créent sur `/inscription` (courriel, nom
   d'utilisateur, mot de passe) et on se connecte avec le courriel et le mot de passe : aucun
   lien par courriel. Si « Confirm email » reste activé, Supabase envoie quand même un lien
   de confirmation et la page de connexion le signale.
   Dans **Authentication → Sign In / Providers → Email** (ou **Policies**, selon la version),
   régler aussi **Minimum password length = 8** et **Password requirements = « Lowercase,
   uppercase letters and digits »** : la même règle que le formulaire, appliquée aussi par
   Supabase.
3. **Google (facultatif)** : Authentication → Sign In / Providers → **Google** → activer, puis
   coller le **Client ID** et le **Client Secret** créés dans Google Cloud Console
   (APIs & Services → Credentials → OAuth client ID → « Web application »). Dans Google,
   l'**Authorized redirect URI** est l'adresse de rappel affichée par Supabase sur cette même
   page (`https://xxxx.supabase.co/auth/v1/callback`), pas celle de l'app.

La route `/auth/callback` ne sert plus qu'au retour de Google.

### 4. Vérifier

`npm run dev`, aller sur <http://localhost:3000>, **Se connecter** → **Créer un compte**,
remplir le formulaire : l'accueil de première connexion s'ouvre, puis l'accueil affiche « Connecté en tant que … » et un bouton **Se
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

Dans `/horaire`, bouton **« Importer un horaire »** (fichier .ics) (exporté de Google Agenda, Outlook ou
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
- **Plans « à revoir »** : voir la section du même nom plus bas. **Pas fait** : le statut `confirmed` n'est pas utilisé (chaque invité répond pour lui-même) ;
  une personne qui rejoint le groupe après une proposition « tout le groupe » la voit mais n'est
  pas invitée.
- Tests : `src/lib/db/__tests__/plans.test.ts` (PGlite, requêtes directes comme par l'API REST,
  y compris la migration 0009 sur une base en 0008 avec des données) et
  `src/lib/plans/__tests__/` (validation, mise en forme, `.ics`).

## Plans « à revoir » et cours annulé cette fois-ci

### Plans « à revoir »

Un plan accepté peut devenir impossible quand l'horaire de quelqu'un change après coup (nouveau
cours, quart de travail, deuxième plan au même moment). Sur mes prochains plans (acceptés ou
proposés par moi), une note **« À revoir »** dit alors qui est pris : « Tu as maintenant
« Labo » de 17 h à 19 h, en même temps que ce plan. » ou « Sam n'est plus libre à ce
moment-là. » Affichée dans `/plans`, sur l'accueil et dans la page du groupe. Aucune migration.

- Logique pure : `src/lib/scheduling/planConflicts.ts` (`conflictingBlock`, `planConflicts`).
  Le bloc du plan lui-même (mêmes heures exactement) est écarté une fois par personne.
- Assemblage : `src/lib/plans/review.ts` (au plus 12 plans, 6 groupes, 60 jours) ; lecture par
  `group_busy_blocks` dans `reviewQueries.ts` (la page du groupe réutilise l'horaire déjà lu).
- Vie privée : pour les autres, seulement le nom (ni titre ni heures de leur bloc) ; le titre
  et les heures ne sont montrés que pour mon propre bloc.
- Limite : seuls les chevauchements sont signalés, pas un trajet devenu trop long.

### Cours annulé cette fois-ci

**Migration à appliquer : `supabase/migration-0021.sql`** (SQL Editor, une seule fois).

« Mon cours de jeudi est annulé » : dans `/horaire`, ouvrir un bloc qui revient puis
**« Annulé le jeudi 12 novembre seulement »**. Ce jour-là, le bloc disparaît de la grille et
ne compte plus comme occupé (« Quand on peut se voir », « Je suis libre maintenant », plans « à
revoir ») ; les autres semaines ne changent pas. La section **« Annulés cette fois-ci »**
liste les occurrences annulées à venir, avec **Rétablir**.

- Colonne `busy_blocks.skip_days` (`date[]`, 60 jours au plus, seulement sur un bloc qui
  revient), écrite par la personne (droit par colonne + RLS) et renvoyée aux membres de ses
  groupes par `group_busy_blocks`.
- Logique pure : `occursOn` ignore les jours de `skipDays` (`weeklyBlocks.ts`) ;
  `src/lib/scheduling/skipDays.ts` (`skipOccurrence`, `restoreOccurrence`, `upcomingSkips`).
- Seulement mes blocs saisis ou importés (pas un plan de groupe ni une séance d'étude).
- Sans la migration, l'app marche comme avant (le bouton dit qu'il manque la migration).
- Pris en compte aussi par le planificateur d'étude (du temps libre pour étudier) et par
  « Pars de … à HH:MM » (on ne part plus d'un cours annulé).

### Trouver un autre moment

Sur un plan « à revoir », le bouton **« Trouver un autre moment »** ouvre la page du groupe
(`/groupes/[id]?replanifier=<plan>#se-voir`) et lance la recherche avec les mêmes personnes et
la même durée (`src/lib/plans/replan.ts`). On propose le nouveau moment comme d'habitude ; si
l'ancien plan est le mien, l'app offre ensuite de l'annuler. Sinon, la personne qui l'a proposé
l'annule elle-même (seul le créateur annule, migration 0009).

### Limite de sorties

**Migration à appliquer : `supabase/migration-0022.sql`** (SQL Editor, une seule fois).

Dans **Profil → Limite de sorties** : « pas plus de N plans de groupe par jour » et « par
semaine » (du lundi au dimanche). Une sortie est un plan accepté ou proposé par moi. Quand la
limite d'un jour ou d'une semaine est atteinte, je compte comme occupé à la maison tout ce
jour-là : « Quand on peut se voir » et « Je suis libre maintenant » ne proposent plus rien.
Les autres voient seulement que je ne suis pas libre.

- Logique pure : `src/lib/scheduling/outingLimits.ts`, appliquée par `toPeople`
  (`convert.ts`). Les sorties sont comptées sur les semaines complètes touchées par la plage.
- BD : `profiles.max_outings_per_day` (1 à 5) et `max_outings_per_week` (1 à 21) ;
  `group_busy_blocks` renvoie `is_outing` pour compter les sorties des autres membres, sans
  révéler le titre ni le groupe d'un plan d'ailleurs.
- Sans la migration, aucune limite n'est appliquée et le profil dit qu'elle manque.
- Limite : en cherchant un autre moment pour un plan, l'ancien plan compte encore comme une
  sortie tant qu'il n'est pas annulé.

## Tests de bout en bout (navigateur)

`npm run test:e2e` construit l'app puis lance Playwright (`e2e/`, config dans
`playwright.config.ts`) dans Chromium, en format ordinateur et téléphone (Pixel 7), sur le
serveur de production (port 3100). Première fois sur une machine : `npx playwright install
chromium`.

Ces tests tournent **sans Supabase** : accueil, changement de langue (FR ↔ EN, gardé dans le
cookie), redirection de chaque page protégée vers `/connexion?next=…`, message « connexion non
configurée », manifeste PWA, pas de défilement horizontal ni d'erreur dans la console.

**Pas couvert** : les pages connectées (horaire, groupes, plans, profil). Elles demandent un
projet Supabase de test (jamais celui de production) avec deux comptes ; à ajouter dans
`e2e/` quand il existera. La logique derrière ces pages reste couverte par Vitest et PGlite.

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

## Planificateur d'étude : l'interface (segment 14)

- Page **`/etude`** (lien « Étude » dans le menu) : ajouter un examen ou un travail (type, cours,
  date et heure, heures estimées ou difficulté), liste « À venir » et « Passés », suppression
  (retire ses séances), séances acceptées de chaque échéance (case « Déplaçable », « Retirer »).
- **« Planifier mon étude »** ouvre `/horaire?etude=planifier` : le serveur
  (`src/app/etude/actions.ts` → `src/lib/study/service.ts`) lit les données au nom de la
  personne (RLS), appelle `planStudySessions` et renvoie les séances **sans rien écrire**. Elles
  s'affichent dans la grille en **pointillé**, couleur « étude » (`--study`, clair et sombre),
  avec les avertissements (« Il te manque 30 min avant l'examen de chimie. »).
- Tout accepter, accepter ou refuser une séance, la décaler de 15 min (flèches) ou la **glisser**
  dans la grille : chaque déplacement est **revalidé par le serveur** (`verifierSeance`), et
  l'acceptation revalide tout de nouveau (`prepareAcceptance`, tout ou rien : échéance et lieu à
  moi, quart d'heure, durée, pas passée, avant l'échéance, aucun bloc ni trajet dessus). Les
  séances acceptées deviennent des blocs `source = 'study'`, `movable = true`, `deadline_id`.
- **Conflits** : si un plan de groupe (bloc `meetup`), un cours ou un trajet tombe sur une séance
  acceptée et déplaçable, `/etude` et `/horaire` affichent « Séance en conflit : replanifier ? ».
  « Replanifier » propose de nouvelles places (rien n'est écrit avant « Déplacer »).
- **Préférences d'étude** dans `/profil` (section « Préférences d'étude ») : durée min et max,
  maximum par jour, pause, heures d'étude, limite de la veille, part des soirées et fins de
  semaine gardée libre.
- Limite : 30 calculs par minute et par personne ; au plus 100 séances par envoi.
- Tests : `src/lib/study/__tests__/validation.test.ts` (formulaires, séances, conversions) et
  `src/lib/db/__tests__/study-service.test.ts` (PGlite : planifier n'écrit rien, accepter, tout
  ou rien, échéance/lieu/séance d'un autre refusés, déplacement revalidé, conflit avec un plan
  de groupe puis replanification, séance « Occupé » dans la recherche de groupe).

## Vrai temps de trajet (segment 15, facultatif)

Sans clé d'API, rien ne change : les trajets sont **estimés** (vol d'oiseau × 1,3, vitesse par
mode, voir plus bas). Avec une clé, « Quand on peut se voir » et le planificateur d'étude
utilisent les vrais temps de trajet.

| Variable              | Modes               | Service                                                          |
| --------------------- | ------------------- | ---------------------------------------------------------------- |
| `ORS_API_KEY`         | marche, vélo, auto  | [OpenRouteService](https://openrouteservice.org), gratuit        |
| `GOOGLE_MAPS_API_KEY` | transport en commun | Google **Routes API** (Route Matrix, Compute Routes), facultatif |

**Obtenir une clé OpenRouteService (gratuite)** :

1. <https://openrouteservice.org> → **Sign up** : créer un compte gratuit (courriel), le
   confirmer, puis se connecter au tableau de bord.
2. Section **API Keys / Tokens** → créer une clé (type « Standard » / gratuit, nom
   « calendrier ») et la copier.
   Quota gratuit : 500 matrices par jour, 40 par minute.
3. En local : `ORS_API_KEY=...` dans `.env.local`. Sur Vercel : projet → **Settings →
   Environment Variables** → `ORS_API_KEY` (Production, et Preview si voulu) → **Save**, puis
   **Deployments → ⋯ → Redeploy** (une variable n'est lue qu'au déploiement suivant).

Google (transport en commun) : Google Cloud Console → activer **Routes API** → **Credentials →
Create credentials → API key**, restreinte à « Routes API ». Payant au-delà du crédit mensuel
gratuit. Sans cette clé, le transport en commun reste estimé.

**Jamais de préfixe `NEXT_PUBLIC_`** sur ces clés : elles ne sont lues que par le serveur
(`src/lib/travel/server.ts`, `server-only`) et n'arrivent jamais au navigateur.

Comment c'est fait (`src/lib/travel/`) :

- `OpenRouteServiceProvider` et `GoogleTransitProvider` : API « matrice » (toutes les paires
  d'une liste de lieux en un appel). `FallbackTravelProvider` les combine avec l'estimation.
- **Préparation avant le calcul** : la recherche demande d'abord les trajets entre ses lieux
  (`prefetch`), puis `findMeetups` (inchangé) ne lit que le cache : il n'attend **jamais** le
  réseau. Bornes : au plus 4 appels par recherche (en parallèle), 3 s par appel, 100 lieux
  par mode, 30 appels par minute et 450 par jour par serveur ; après une erreur, l'API est
  mise de côté 1 min. Tout trajet non obtenu (panne, délai, quota, budget) est **estimé**.
- **Cache en mémoire du serveur** (LRU borné, 30 jours), par coordonnées arrondies (≈ 11 m) et
  mode. Choix plutôt qu'une table `travel_cache` : seules les réponses des API y entrent, jamais
  une valeur envoyée par un utilisateur, donc personne ne peut fausser les trajets des autres ;
  et aucune migration. Contrepartie : chaque instance Vercel a son propre cache, perdu au
  redémarrage (quelques appels de plus, toujours bornés).
- Transport en commun : départ « maintenant » (approximation ; l'horaire varie dans la journée).
- Tests avec `fetch` simulé et les vraies formes de réponse : `src/lib/travel/__tests__/`,
  `src/lib/meetups/__tests__/search-travel.test.ts`.

## Bonus (segment 18)

### App installable (PWA)

Sur le téléphone, ouvrir l'app dans le navigateur puis **Ajouter à l'écran d'accueil**
(Safari : bouton Partager ; Chrome : menu ⋮ → **Installer l'application**). Elle s'ouvre alors
en plein écran, avec sa propre icône.

- Manifeste : `src/app/manifest.ts` (servi à `/manifest.webmanifest`, public : exclu du
  middleware, sinon le navigateur, qui le charge sans cookie, serait renvoyé à `/connexion`).
- Icônes : `public/icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
  `apple-touch-icon.png`, produites par `node scripts/generate-icons.mjs` (à relancer seulement
  si le dessin change).
- **Pas de service worker** : rien n'est mis en cache, donc aucune page connectée ni réponse
  `/api` ne peut être servie à la mauvaise personne ou périmée. L'app a besoin du réseau.

### « Je suis libre maintenant »

Bouton **Qui est libre ?** sur l'accueil (dès qu'un groupe compte un ami et que ma maison est
choisie) et sur la page d'un groupe. Pour chaque membre de mes groupes (ou de ce groupe), il
cherche la meilleure rencontre à deux qui tient dans les **2 prochaines heures** (au moins
30 min, trajets et marge de 5 min compris) : en personne si possible (la plus tôt, puis le
moins de trajet), sinon un appel. Sur la page du groupe, **Proposer ce moment** ouvre le
formulaire de plan déjà rempli.

- Logique pure : `src/lib/scheduling/freeNow.ts` (`findMeetupSoon`, qui réutilise
  `findMeetupCandidates` et `findCallSlots`).
- Service : `src/lib/meetups/freeNow.ts` (mêmes lectures RLS que « Quand on peut se voir »,
  horaires par `group_busy_blocks`, lieux favoris d'un groupe seulement avec ses membres ;
  au plus 10 groupes et 40 personnes).
- Action : `chercherLibresMaintenant` (`src/app/groupes/meetup-actions.ts`) : compte dans la
  limite des recherches de moments (20/min) et a sa propre limite (6/min par personne).

### Disponibilités ponctuelles

« Ce samedi, je suis libre de 13 h à 18 h » : dans **Mon horaire**, section **Disponibilités
ponctuelles** (jour, de, à, note privée facultative).

Le modèle existant ne suffisait pas : il ne connaît que des blocs **occupés**, et tout le reste
est déjà libre. Une disponibilité dit autre chose, d'où la table `availability_slots`
(migration 0012, **à appliquer** : `supabase/migration-0012.sql`). Règle, ce jour-là
seulement (`applyOneOffAvailability`, `src/lib/scheduling/oneOffAvailability.ts`) :

- je ne suis disponible **que** pendant mes disponibilités : le reste de la journée compte comme
  occupé, à la maison ;
- pendant mes disponibilités, mes blocs **hebdomadaires** (cours, travail) et mes heures « je
  ne sors pas » sont levés (ex. le shift du samedi est annulé cette fois-ci) ;
- mes blocs **ponctuels** (plan accepté, séance d'étude, rendez-vous de ce jour-là) comptent
  toujours.

Pris en compte par « Quand on peut se voir » (propositions et grille) et « Je suis libre
maintenant ». Pas par le planificateur d'étude (une disponibilité sert à voir des amis).

Sécurité (comme les migrations précédentes) : RLS (seulement la personne), droits par colonne,
CHECK (au moins 15 min, note d'une ligne de 60 caractères au plus, sans caractère de contrôle),
trigger (jour entre hier et dans un an, 100 disponibilités à venir au plus). Les membres de mes
groupes lisent jour et heures par `group_availability_slots(gid)`, jamais la note. Sans la
migration, l'app marche comme avant (la section dit qu'il manque la migration).

## Calendrier Outlook (connecteur, facultatif)

Profil → **Calendrier Outlook** → « Connecter Outlook » : la personne se connecte avec son
compte Microsoft (personnel Outlook.com/Hotmail **ou** travail/école Microsoft 365) et ses
événements Outlook comptent comme du temps occupé partout (horaire, recherche de moments,
planificateur d'étude), sans les entrer à la main.

Choix faits :

| Question                  | Choix                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Où ?                      | Page **Profil**, carte « Calendrier Outlook »                                                                                    |
| Types de comptes          | Les deux (point de terminaison Microsoft `common`)                                                                               |
| Calendriers lus           | Le principal par défaut ; « Choisir le calendrier » pour en prendre un autre (un seul)                                           |
| Ce que les autres voient  | « Occupé » et l'heure, **jamais** le titre ni le lieu (même si la personne montre ses titres)                                    |
| Lecture / écriture        | **Lecture seule** (`Calendars.Read`) : l'app n'écrit jamais dans Outlook                                                         |
| Synchro                   | Aux 15 min **quand la personne a l'app ouverte**, + bouton « Actualiser maintenant » (au plus 1 fois/min), 8 semaines à l'avance |
| Déconnexion               | Supprime **tout de suite** la connexion (jeton) et tous les blocs Outlook                                                        |
| Événements « Disponible » | Ignorés ; occupé, provisoire, absent, ailleurs : occupés. Annulés : ignorés                                                      |
| Lieu                      | Aucun : un bloc Outlook est « à la maison » pour les trajets                                                                     |

**Mise en place (une fois, par l'admin du site)** :

1. <https://portal.azure.com> (compte Microsoft ; un compte Azure gratuit suffit, une
   inscription d'app ne coûte rien) → chercher **App registrations** → **New registration**.
   - Name : `Temps libre commun`.
   - Supported account types : **Accounts in any organizational directory (Any Microsoft
     Entra ID tenant - Multitenant) and personal Microsoft accounts**.
   - Redirect URI : plateforme **Web**, `https://calendrier-opal.vercel.app/api/outlook/callback`.
   - **Register**.
2. Page de l'app → **Authentication** → **Add URI** :
   `http://localhost:3000/api/outlook/callback` (pour `npm run dev`) → **Save**.
3. **Certificates & secrets** → **New client secret** (24 mois) → copier la **Value** tout de
   suite (elle ne s'affiche qu'une fois). Noter la date d'expiration : il faudra la renouveler.
4. **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated
   permissions** → cocher `Calendars.Read`, `User.Read`, `offline_access` → **Add
   permissions**. (Pas besoin de « Grant admin consent ».)
5. **Overview** → copier **Application (client) ID**.
6. Générer la clé de chiffrement :
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
7. Variables (local : `.env.local` ; Vercel : Settings → Environment Variables, puis
   **Redeploy**) : `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `OUTLOOK_TOKEN_KEY`.
   Jamais de préfixe `NEXT_PUBLIC_`. Ne pas changer `OUTLOOK_TOKEN_KEY` ensuite (sinon chacun
   doit reconnecter Outlook).
8. Supabase → SQL Editor : coller `supabase/migration-0014.sql` → **Run**.

Limite à connaître : un compte de **travail/école** (ex. celui du cégep) peut afficher
« Approbation de l'administrateur requise » si l'organisation interdit aux élèves d'autoriser
des apps d'éditeurs non vérifiés. Les comptes personnels marchent toujours.

Sécurité et confidentialité (`src/lib/outlook/`, migration 0014) :

- Flux OAuth « code d'autorisation » avec **PKCE** et secret client côté serveur ; `state`
  aléatoire gardé dans un cookie `httpOnly` **chiffré**, lié à la personne connectée, 10 min.
- Seul le **jeton de rafraîchissement** est gardé, **chiffré** (AES-256-GCM, clé
  `OUTLOOK_TOKEN_KEY` connue du serveur seulement, lié au propriétaire). Le jeton d'accès (1 h)
  n'est jamais enregistré. Rien de tout ça n'arrive au navigateur.
- Table `outlook_connections` : RLS, lisible et modifiable **par la personne seulement**.
- On ne demande à Graph que début, fin, « toute la journée », `showAs` et annulation : aucun
  titre, lieu, description ni participant n'est lu ni enregistré. Les blocs s'appellent
  « Outlook » (`source = 'outlook'`), sont ponctuels, sans lieu, et ne s'écrivent que par
  `replace_outlook_blocks` (remplacement complet en une transaction, 500 au plus).
- Le jeton n'est envoyé qu'à `graph.microsoft.com` (un « nextLink » qui pointerait ailleurs est
  refusé). Délai de 10 s par appel.
- Pourquoi pas de synchro quand l'app est fermée : il faudrait que le serveur lise les jetons
  de tout le monde, donc la clé `service_role`, que l'app n'utilise jamais. Les amis voient
  donc l'état Outlook de la dernière visite de la personne.

Logique pure et tests : `src/lib/scheduling/outlookBusy.ts` (découpage par jour local, minuit,
heure avancée, fusion), `src/lib/outlook/__tests__/` (OAuth, Graph, synchro avec `fetch`
simulé), `rls.test.ts` (RLS, fonctions, migration 0014 sur une base existante).

## Calendriers en ligne abonnés (story 3)

**Profil → Calendriers en ligne** : coller le lien d'un calendrier qui se met à jour tout seul
(horaire de la Formule 1, d'une équipe, fêtes…), ou choisir un calendrier du compte Outlook
connecté (les calendriers abonnés dans Outlook y apparaissent, marqués « abonné »). Demande la
migration `supabase/migration-0017.sql`. Aucune variable d'environnement de plus.

Choix :

- **Formats** : iCalendar (`.ics`) en `https://`, `http://`, `webcal://` ou `webcals://`
  (changé en `https://`). Événements à heures précises (comme l'import .ics) ; ceux d'une
  journée entière sont ignorés. Les événements marqués « disponible » sont gardés : c'est la
  personne qui choisit.
- **Comptes** : Outlook seulement (le connecteur existant). Google n'a pas de connecteur ; on
  colle son « adresse secrète au format iCal ».
- **Compte comme occupé** : aucune valeur par défaut, la personne choisit à l'ajout (et peut
  changer ensuite). Non : affiché dans « Mon horaire » (bordure pointillée), ne bloque rien.
- **Visibilité** : personne d'autre ne voit le calendrier ni son lien. S'il compte comme
  occupé, les membres des groupes voient « Occupé » à ces heures (jamais le titre).
- **Mise à jour** : 8 semaines à partir de la semaine en cours, aux 6 h quand l'app est ouverte
  (comme Outlook, pas de synchro app fermée sans `service_role`) et avec « Actualiser »
  (2 min au plus). Au plus 10 calendriers, 300 événements chacun.
- **Lien brisé** : on garde la dernière version connue et on affiche l'erreur. Un lien qui ne
  marche pas à l'ajout n'est pas ajouté.
- **Retrait** : les événements et les blocs partent avec le calendrier.

Sécurité (le lien vient de la personne : risque de SSRF) : `src/lib/subscriptions/url.ts`
refuse les ports inhabituels, les identifiants, les noms internes et les IP privées ;
`safeFetch.ts` vérifie **chaque** adresse IP résolue au moment de la connexion (contre le
« DNS rebinding »), revérifie chaque redirection (3 au plus, jamais https → http), coupe à
1 Mo et 10 s, sans décompression. 20 téléchargements par minute et par personne. Tables
`calendar_subscriptions` et `subscription_events` : RLS, propriétaire seulement ; personne ne
les modifie directement (fonctions `claim_subscription_syncs`, `replace_subscription_events`,
`fail_subscription_sync`, `set_subscription_busy`).

## Heure de départ (story 6)

Sur « Mes plans » et l'accueil, chacun de mes prochains plans **en personne** (proposé par moi,
ou où je suis invité·e sans avoir refusé) affiche : « Pars de « Cégep » à 15 h 42 · Arrivée
prévue 16 h 05 ». Rien pour un appel ou un lieu écrit à la main (pas de coordonnées).

- **Lieu d'avant** : le dernier bloc de MON horaire qui commence avant le plan le même jour (même
  règle que le « lieu avant » de `getFreeWindows`) ; sinon la maison (« de chez toi »). Le bloc
  créé par ce plan quand je l'ai accepté ne compte pas.
- **Marche, vélo, auto** : départ = début − trajet − marge (5 min, la marge par défaut de la
  recherche). Trajet par l'API (segment 15) si configurée, sinon estimé et dit « Estimation ».
- **Transport en commun** : avec `GOOGLE_MAPS_API_KEY`, Google **Compute Routes** (même clé,
  même Routes API) donne le vrai trajet pour la date du plan : « Bus 51 à 15 h 42 (arrêt …) ».
  On demande d'arriver au plus tard au début du plan moins la marge ; si je ne peux pas être à
  l'heure, le premier trajet qui part à la fin de mon bloc. Plans dans les 7 prochains jours
  seulement ; sinon, estimation.
- **En retard** : si l'heure de départ tombe avant la fin de mon bloc, l'app dit « Pars dès
  14 h 50 » et « Tu arriveras vers 15 h 07, 7 min en retard. » au lieu d'une heure impossible.
- **Bornes** : au plus 6 plans par page ; chaque appel Compute Routes compte dans la limite de
  40 appels d'API par personne et par jour et dans les limites globales de Google ; 3 s par
  appel ; cache en mémoire de 6 h **par personne**. Tout ce qui échoue est estimé.
- **Vie privée** : seuls MES blocs et mes lieux servent, le résultat n'est montré qu'à moi ; le
  lieu d'avant des autres n'est jamais lu. Aucune table ni migration.
- Code : `src/lib/scheduling/leaveBy.ts` (logique pure), `src/lib/travel/googleRoutes.ts` et
  `transitRouter.ts` (API), `src/lib/plans/leaveBy.ts` (assemblage et phrases),
  `leaveByQueries.ts` (lectures).

## Déploiement (Vercel) et vérification automatique (segment 17)

L'app est en ligne : <https://calendrier-opal.vercel.app>. Le projet Vercel est relié au dépôt
GitHub : **chaque push sur `main` déploie la production**, chaque PR reçoit un aperçu
(« Preview »).

### Variables d'environnement (Vercel → projet → Settings → Environment Variables)

| Variable                        | Obligatoire | Valeur                                                                        |
| ------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | oui         | Supabase → Project Settings → API : « Project URL »                           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | oui         | clé publique : « anon » (`eyJ…`) ou la **publishable key** `sb_publishable_…` |
| `NEXT_PUBLIC_SITE_URL`          | non         | `https://calendrier-opal.vercel.app` (sinon l'adresse de la requête)          |
| `ORS_API_KEY`                   | non         | vrais temps de trajet (voir segment 15) ; jamais `NEXT_PUBLIC_`               |
| `GOOGLE_MAPS_API_KEY`           | non         | transport en commun (voir segment 15) ; jamais `NEXT_PUBLIC_`                 |
| `MICROSOFT_CLIENT_ID`           | non         | connecteur Outlook (voir « Calendrier Outlook ») ; jamais `NEXT_PUBLIC_`      |
| `MICROSOFT_CLIENT_SECRET`       | non         | connecteur Outlook ; jamais `NEXT_PUBLIC_`                                    |
| `OUTLOOK_TOKEN_KEY`             | non         | connecteur Outlook : 32 octets base64 pour chiffrer les jetons                |

Jamais la clé `service_role` ni la `secret key` (`sb_secret_…`). Après avoir changé une
variable : **Deployments → ⋯ → Redeploy** (les `NEXT_PUBLIC_` sont figées au build).

### Supabase en production

1. **Authentication → URL Configuration**
   - **Site URL** : `https://calendrier-opal.vercel.app`
   - **Redirect URLs** : `https://calendrier-opal.vercel.app/auth/callback` et
     `http://localhost:3000/auth/callback` (développement). Pour les aperçus Vercel, on peut
     ajouter `https://*-<équipe>.vercel.app/**`.
2. **Authentication → Emails (modèles)** : plus nécessaire depuis la création de compte par
   mot de passe (« Confirm email » désactivé). Seulement si on réactive un lien par courriel,
   utiliser `token_hash` plutôt que le lien par défaut :
   - **Magic Link** :
     `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink`
   - **Confirm signup** :
     `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup`
3. **Limite de courriels** : le service de courriel intégré de Supabase n'envoie que
   **2 courriels par heure** (tout le projet). Pour plus, brancher un SMTP perso
   (Authentication → Emails → SMTP Settings).
4. **Comptes de test** : sans courriel, créer des comptes dans **Authentication → Users → Add
   user → Create new user** (courriel + mot de passe, « Auto Confirm User » coché), puis se
   connecter avec « mot de passe » sur `/connexion`.

### CI : GitHub Actions

`.github/workflows/ci.yml` lance, sur chaque **pull request** et chaque **push sur `main`**,
avec Node 22 : `npm ci`, `npm run lint`, `npm test` (y compris les tests de BD PGlite, en
mémoire) et `npm run build`. **Aucun secret** : le build passe sans variable.

Rendre le CI obligatoire (à faire une fois, par ali) : GitHub → dépôt → **Settings → Branches →
Add branch protection rule** (ou **Rules → Rulesets**) pour `main` → cocher **Require a pull
request before merging** et **Require status checks to pass** → chercher et choisir
**« Lint, tests et build »** (le check apparaît après une première exécution du CI) → **Save**.
Une PR dont les tests échouent ne peut alors plus être fusionnée.

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

| #   | Segment                           | État    |
| --- | --------------------------------- | ------- |
| 0   | Mise en place du projet           | Fait    |
| 1   | Types et données de test          | Fait    |
| 2   | Fenêtres libres                   | Fait    |
| 3   | Temps de trajet (estimation)      | Fait    |
| 4   | Recherche de rencontres           | Fait    |
| 5   | Classement des propositions       | Fait    |
| 6   | Base de données et comptes        | Fait    |
| 7   | Mes lieux                         | Fait    |
| 8   | Mon horaire (saisie manuelle)     | Fait    |
| 9   | Import d'horaire .ics             | Fait    |
| 10  | Groupes et amis                   | Fait    |
| 11  | Vue « quand on peut se voir »     | Fait    |
| 12  | Proposer un moment au groupe      | Fait    |
| 13  | Planificateur d'étude : logique   | Fait    |
| 14  | Planificateur d'étude : interface | Fait    |
| 15  | Vrai temps de trajet (API)        | Fait    |
| 16  | Import par capture d'écran / PDF  | À faire |
| 17  | Déploiement et CI                 | Fait    |
| 18  | Bonus (sans courriel/push)        | Fait    |
| —   | Connecteur Outlook (user story)   | Fait    |

## Le cœur : `src/lib/scheduling/`

Logique pure (sans BD ni React), entièrement testée avec Vitest (`__tests__/`).

| Fichier           | Rôle                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `types.ts`        | Vocabulaire : `Place`, `BusyBlock`, `Person`, `FreeWindow`, `MeetupRequest`, `MeetupProposal`… |
| `time.ts`         | Heures locales `America/Toronto` (heure avancée comprise), jours `yyyy-MM-dd`                  |
| `freeWindows.ts`  | `getFreeWindows(person, dayStart, dayEnd, options)` : trous libres + lieu avant/après          |
| `travel.ts`       | `TravelTimeProvider` et `EstimatedTravelProvider` (haversine × 1,3, vitesse par mode, cache)   |
| `leaveBy.ts`      | Story 6 : `previousStop`, `transitQueryFor`, `leaveByTime` (heure de départ d'un plan)         |
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
