# Plan de projet : app de temps libre commun « réaliste »

> Plan pensé pour être exécuté par **Claude Code, un segment à la fois**.
> Chaque segment est autonome : objectif, livrables, critères de fin, et un prompt prêt à coller.
> Règle d'or : **ne passe au segment suivant que lorsque les critères de fin du segment courant sont tous cochés.**

---

## 1. L'idée en une phrase

Une app où des amis entrent leurs horaires (cours, travail, etc.) et leurs lieux habituels, et qui leur propose **des moments ET des endroits** où se voir qui sont vraiment faisables, en tenant compte du **temps de trajet**, d'une **durée minimale** de rencontre et de **l'endroit** où chacun se trouve avant et après.

Exemple : ali a une pause de 1 h au cégep. Son ami est à Montréal à 40 min de transport. L'app ne propose **pas** de se voir à Montréal (40 + 40 min de trajet = il reste 0 min). Elle propose plutôt un appel, ou un autre moment.

L'app aide aussi à **organiser son propre horaire** : quand j'entre un examen (ex. mardi), elle propose des **séances d'étude** dans mes vrais moments libres d'ici là, et les place dans mon horaire une fois acceptées.

---

## 2. Choix par défaut (modifiables)

| Sujet | Choix | Pourquoi |
|---|---|---|
| App | **Next.js 15 (App Router) + TypeScript** | Une seule base de code front + back, se déploie gratuitement sur Vercel, très bien connu de Claude Code. |
| Style | **Tailwind CSS + shadcn/ui** | Composants propres rapidement, sans designer. |
| Base de données + comptes | **Supabase** (Postgres + Auth) | Gratuit, comptes par courriel ou Google en quelques lignes, tableau de bord pour voir les données. |
| Accès BD | **Drizzle ORM** | Schéma typé en TypeScript, migrations simples. |
| Tests | **Vitest** | Indispensable pour l'algorithme « réaliste ». |
| Dates/heures | **date-fns + date-fns-tz** (fuseau `America/Toronto`) | Évite les bugs d'heure avancée. |
| Temps de trajet | V1 : **estimation maison** (distance à vol d'oiseau × facteur, vitesse par mode). V2 : **OpenRouteService** (gratuit) ou Google Distance Matrix. | On peut tout construire et tester sans clé d'API, puis brancher une vraie API. |
| Import d'horaire | V1 : **saisie manuelle** + **fichier .ics**. V2 : **capture d'écran / PDF d'Omnivox** lu par l'API Claude. | Omnivox n'exporte pas toujours en .ics ; la capture d'écran couvre tous les cégeps. |
| Langue de l'interface | Français (Québec) | |

---

## 3. Le cœur : la logique « réaliste »

C'est la partie la plus importante. Elle est écrite en **fonctions pures** (sans BD, sans interface) dans `src/lib/scheduling/`, et couverte par des tests. Tout le reste de l'app ne fait que l'appeler.

### Concepts

- **Bloc occupé** : `{ début, fin, lieuId, titre }` (ex. cours de 10 h à 12 h au cégep).
- **Lieu** : `{ id, nom, lat, lng }` (cégep, maison, travail, café préféré…).
- **Mode de transport** par personne : marche, vélo, transport en commun, auto.
- **Fenêtre libre** : trou entre deux blocs occupés, avec le **lieu avant** et le **lieu après**.
- **Durée minimale** : réglée par la demande (ex. « au moins 45 min ensemble »).
- **Marge** : temps tampon (ex. 5 min) ajouté à chaque trajet.

### Algorithme

Pour un groupe de personnes, un jour donné et un lieu candidat **P** :

1. Pour chaque personne, calculer ses fenêtres libres de la journée (les nuits et heures « je ne veux pas » comptent comme occupées).
2. Pour chaque fenêtre libre `[finBlocPrécédent, débutBlocSuivant]` :
   - arrivée au plus tôt à P = `finBlocPrécédent + trajet(lieuAvant → P) + marge`
   - départ au plus tard de P = `débutBlocSuivant − trajet(P → lieuAprès) − marge`
   - si arrivée < départ, la personne est **réellement disponible à P** sur `[arrivée, départ]`.
3. Faire l'**intersection** des intervalles de tout le monde.
4. Garder les intersections **≥ durée minimale**.
5. Répéter pour chaque lieu candidat, puis **classer** les propositions.

### Lieux candidats

- Les lieux enregistrés de chaque participant (son cégep, sa maison…).
- Les lieux « favoris » du groupe (café, parc…).
- Le cas « même lieu » (deux amis au même cégep) donne un trajet de 0 min, donc c'est souvent la meilleure option.

### Classement (score)

Score plus élevé quand : la rencontre est plus longue, le trajet total du groupe est plus court, le trajet est réparti équitablement, c'est plus tôt dans la semaine. Les poids sont des constantes faciles à ajuster.

### Cas limites à tester

- Fenêtre de 1 h, ami à 40 min : aucune proposition chez lui.
- Deux personnes au même cégep, pause commune de 30 min, durée minimale 20 min : proposé au cégep.
- Début ou fin de journée (pas de bloc avant/après) : on utilise le lieu « maison ».
- Chevauchement de blocs, blocs collés, heure avancée.

---

## 3 bis. Le planificateur d'étude

Même principe que la recherche de rencontres, mais pour une seule personne. Logique pure dans `src/lib/scheduling/studyPlanner.ts`, testée.

### Concepts

- **Échéance** : `{ id, type: 'examen'|'travail', cours, date, heuresEstimées, difficulté 1-3 }`. Si l'utilisateur ne connaît pas les heures, défaut selon difficulté (ex. 3 h, 5 h, 8 h).
- **Séance d'étude** : bloc proposé `{ début, fin, lieuId, échéanceId }`.
- **Préférences** : durée d'une séance (min 45 min, max 2 h), maximum d'étude par jour (ex. 3 h), heures où je n'étudie pas, pause entre deux séances, ne pas étudier le soir juste avant l'examen après une certaine heure.

### Algorithme

1. Prendre les fenêtres libres (fonction du segment 2) entre aujourd'hui et l'échéance, en comptant les plans confirmés et les séances déjà acceptées comme occupés.
2. **Réalisme** : la séance a lieu là où je suis déjà (au cégep entre deux cours, ou à la maison). On retire le temps de trajet si la fenêtre implique de changer de lieu, exactement comme pour les rencontres. Une fenêtre trop courte une fois le trajet retiré est ignorée.
3. **Répartition espacée** : on étale les heures nécessaires sur plusieurs jours, avec plus de poids dans les 2 ou 3 jours avant l'examen, mais jamais tout la veille. Une révision courte est placée la veille.
4. **Plusieurs échéances** : on traite la plus proche et la plus lourde en premier ; si le temps libre ne suffit pas, on le dit clairement (« il te manque 2 h avant l'examen de chimie ») au lieu de surcharger.
5. Ne jamais prendre tout le temps libre : on laisse au moins une partie des soirées et des fins de semaine libres (paramètre).

### Lien avec les rencontres

- Les séances **proposées** n'occupent rien. Une fois **acceptées**, elles deviennent des blocs occupés (`source = 'study'`).
- Une séance acceptée peut être marquée **déplaçable** : si une rencontre de groupe tombe dessus, l'app propose de la déplacer ailleurs plutôt que de bloquer la rencontre.

### Cas limites à tester

- Examen mardi, 4 h nécessaires, pauses au cégep lundi et mardi matin : les séances tombent dans ces pauses, pas à Montréal.
- Pas assez de temps libre : alerte avec le nombre d'heures manquantes.
- Deux examens la même semaine : les deux reçoivent du temps, le plus proche d'abord.
- Échéance déjà passée ou aujourd'hui : rien de proposé, ou seulement une révision courte.

---

## 4. Architecture des dossiers (cible)

```
src/
  app/                 # pages Next.js (App Router)
    (auth)/            # connexion
    horaire/           # mon horaire
    lieux/             # mes lieux
    groupes/[id]/      # un groupe, ses disponibilités, ses plans
    etude/             # examens, travaux et séances d'étude
  lib/
    scheduling/        # LOGIQUE PURE + tests (cœur de l'app)
      types.ts
      freeWindows.ts
      travel.ts
      findMeetups.ts
      score.ts
      studyPlanner.ts
      __tests__/
    travel/            # fournisseurs de temps de trajet (estimation, ORS)
    import/            # parseurs .ics, image/PDF
    db/                # schéma Drizzle, requêtes
  components/
CLAUDE.md              # règles du projet pour Claude Code
```

---

## 5. Comment utiliser ce plan avec Claude Code

1. Crée un dossier vide (ou un repo GitHub vide) et ouvre Claude Code dedans.
2. Copie ce fichier dans le projet sous `docs/plan-projet.md`.
3. Pour chaque segment : colle le **prompt** du segment, laisse Claude Code travailler, puis vérifie toi-même les **critères de fin**.
4. Fais un commit à la fin de chaque segment (`git commit -m "Segment N : ..."`). Si un segment part de travers, tu peux revenir au commit précédent.
5. Démarre une **nouvelle conversation** Claude Code à chaque segment : le `CLAUDE.md` et `docs/plan-projet.md` lui redonnent le contexte. Ça garde ses réponses précises.

---

## 6. Les segments

Vue d'ensemble :

| # | Segment | Phase |
|---|---|---|
| 0 | Mise en place du projet | Fondations |
| 1 | Types et données de test | Cœur |
| 2 | Fenêtres libres | Cœur |
| 3 | Temps de trajet (estimation) | Cœur |
| 4 | Recherche de rencontres réalistes | Cœur |
| 5 | Classement des propositions | Cœur |
| 6 | Base de données et comptes | App |
| 7 | Mes lieux | App |
| 8 | Mon horaire (saisie manuelle) | App |
| 9 | Import d'horaire .ics | Import |
| 10 | Groupes et amis | App |
| 11 | Vue « quand on peut se voir » | App |
| 12 | Plan d'action (proposer, voter, confirmer) | App |
| 13 | Planificateur d'étude : logique | Étude |
| 14 | Planificateur d'étude : interface | Étude |
| 15 | Vrai temps de trajet (API) | Amélioration |
| 16 | Import d'horaire par capture d'écran/PDF | Import |
| 17 | Déploiement | Mise en ligne |
| 18 | Finition (mobile, PWA, notifications) | Bonus |

Les segments 1 à 5 se font **sans interface ni base de données** : c'est voulu. On valide la logique avant de construire autour.

---

### Segment 0 : Mise en place du projet

**Objectif** : un projet Next.js qui démarre, avec les outils et les règles en place.

**Livrables**
- Projet Next.js 15 + TypeScript + Tailwind + shadcn/ui + Vitest + ESLint/Prettier.
- `CLAUDE.md` à la racine avec les règles du projet.
- Page d'accueil « Temps libre commun » en français.

**Critères de fin**
- [ ] `npm run dev` affiche la page d'accueil.
- [ ] `npm test` passe (un test bidon suffit).
- [ ] `npm run lint` et `npm run build` passent sans erreur.
- [ ] `CLAUDE.md` existe.

**Prompt**
```
Lis docs/plan-projet.md (sections 2, 3 et 4). Mets en place le projet :
- Next.js 15 (App Router), TypeScript strict, Tailwind, shadcn/ui, Vitest, ESLint, Prettier.
- Installe date-fns et date-fns-tz.
- Crée la structure de dossiers de la section 4 (dossiers vides avec .gitkeep si besoin).
- Crée une page d'accueil simple en français : "Temps libre commun".
- Ajoute un test Vitest minimal qui passe.
- Crée un CLAUDE.md qui dit : l'interface est en français (Québec) ; le fuseau horaire est
  America/Toronto ; toute la logique d'horaire va dans src/lib/scheduling en fonctions pures
  testées, sans accès BD ni React ; chaque nouvelle fonction de scheduling a des tests ;
  lancer npm test, npm run lint et npm run build avant de dire qu'une tâche est finie ;
  le plan est dans docs/plan-projet.md.
Vérifie que npm run dev, npm test, npm run lint et npm run build fonctionnent.
```

---

### Segment 1 : Types et données de test

**Objectif** : définir le vocabulaire de l'app en TypeScript et créer des horaires d'exemple réalistes.

**Livrables**
- `src/lib/scheduling/types.ts` : `Place`, `TravelMode`, `BusyBlock`, `Person`, `FreeWindow`, `Availability`, `MeetupRequest`, `MeetupProposal`.
- `src/lib/scheduling/__tests__/fixtures.ts` : 3 ou 4 personnes fictives (ex. 2 au même cégep à Longueuil, 1 à l'UdeM, 1 qui travaille à Laval) avec une semaine d'horaire.

**Critères de fin**
- [ ] Les types compilent, aucun `any`.
- [ ] Les fixtures utilisent de vraies coordonnées approximatives et des horaires plausibles.

**Prompt**
```
Lis docs/plan-projet.md section 3. Crée src/lib/scheduling/types.ts avec les types :
Place {id, name, lat, lng}, TravelMode ('walk'|'bike'|'transit'|'car'),
BusyBlock {id, start: Date, end: Date, placeId, title},
Person {id, name, homePlaceId, travelMode, busyBlocks, places},
FreeWindow {start, end, placeBeforeId, placeAfterId},
Availability {personId, start, end} (intervalle où la personne peut être à un lieu donné),
MeetupRequest {personIds, day ou plage de dates, minDurationMinutes, bufferMinutes, candidatePlaceIds?},
MeetupProposal {placeId, start, end, travelByPerson: Record<personId, {to: minutes, from: minutes}>, score}.
Documente chaque champ en une ligne. Puis crée des fixtures dans
src/lib/scheduling/__tests__/fixtures.ts : 4 personnes (2 étudiants du même cégep sur la
Rive-Sud, 1 à l'Université de Montréal, 1 qui travaille à Laval), avec leurs lieux
(coordonnées réelles approximatives) et une semaine de cours/travail plausible.
Pas de logique encore.
```

---

### Segment 2 : Fenêtres libres

**Objectif** : à partir des blocs occupés d'une personne, calculer ses trous libres avec le lieu avant et après.

**Livrables**
- `freeWindows.ts` : `getFreeWindows(person, dayStart, dayEnd, options)`.
- Options : heures de la journée considérées (ex. 8 h à 22 h), fusion des blocs qui se chevauchent.
- Lieu avant/après = lieu du bloc voisin, ou la maison en début/fin de journée.

**Critères de fin**
- [ ] Tests pour : journée vide, blocs collés, blocs qui se chevauchent, bloc qui dépasse la journée, changement d'heure (novembre/mars).
- [ ] `npm test` passe.

**Prompt**
```
Lis docs/plan-projet.md section 3 et src/lib/scheduling/types.ts. Implémente
src/lib/scheduling/freeWindows.ts avec getFreeWindows(person, dayStart, dayEnd, options).
Règles : trier et fusionner les blocs qui se chevauchent ; une fenêtre libre est un trou
entre deux blocs dans [dayStart, dayEnd] ; placeBeforeId = lieu du bloc précédent (ou
homePlaceId s'il n'y en a pas) ; placeAfterId = lieu du bloc suivant (ou homePlaceId).
Ignore les fenêtres de durée nulle. Utilise date-fns, fuseau America/Toronto.
Écris des tests Vitest complets : journée vide, blocs collés, chevauchements, blocs qui
débordent de la journée, jour de changement d'heure. Lance npm test.
```

---

### Segment 3 : Temps de trajet (estimation)

**Objectif** : estimer un temps de trajet entre deux lieux, sans API, derrière une interface qu'on pourra remplacer plus tard.

**Livrables**
- `travel.ts` : interface `TravelTimeProvider { minutes(from, to, mode): Promise<number> }`.
- `EstimatedTravelProvider` : distance haversine × facteur de détour (1,3), vitesses moyennes par mode (marche 4,5 km/h, vélo 15, transport en commun 18 + 10 min d'attente, auto 30 + 5 min de stationnement), 0 min si même lieu.
- Cache en mémoire des paires déjà calculées.

**Critères de fin**
- [ ] Même lieu = 0 min.
- [ ] Cégep de la Rive-Sud vers centre-ville de Montréal en transport en commun donne une valeur plausible (environ 35 à 60 min).
- [ ] Tests passent.

**Prompt**
```
Lis docs/plan-projet.md section 3. Crée src/lib/scheduling/travel.ts avec une interface
TravelTimeProvider { minutes(from: Place, to: Place, mode: TravelMode): Promise<number> }
et une implémentation EstimatedTravelProvider : distance haversine × 1.3 ; vitesses
marche 4.5 km/h, vélo 15 km/h, transport en commun 18 km/h + 10 min fixes, auto 30 km/h
+ 5 min fixes ; 0 minute si même lieu ; arrondi à la minute supérieure. Ajoute un cache
en mémoire par (from, to, mode). Toutes les constantes sont exportées et nommées.
Tests : même lieu, symétrie, ordres de grandeur plausibles avec les lieux des fixtures.
```

---

### Segment 4 : Recherche de rencontres réalistes

**Objectif** : le cœur. Pour un groupe et une période, trouver les créneaux et lieux où **tout le monde peut vraiment être présent** assez longtemps.

**Livrables**
- `findMeetups.ts` : `findMeetups(people, request, travelProvider): Promise<MeetupProposal[]>`, en suivant exactement l'algorithme de la section 3 (fenêtres libres, arrivée au plus tôt, départ au plus tard, intersection, durée minimale).
- Lieux candidats : ceux de la requête, sinon tous les lieux des participants + favoris.

**Critères de fin**
- [ ] Test « ali » : pause de 1 h au cégep, ami à ~40 min : **aucune** proposition chez l'ami.
- [ ] Test : deux amis au même cégep avec une pause commune de 30 min et minimum 20 min : proposé au cégep.
- [ ] Test : fin de journée, chacun rentre chez soi : propositions possibles près de chez l'un d'eux.
- [ ] Test : groupe de 3 avec intersection trop courte : aucune proposition.
- [ ] Tests passent.

**Prompt**
```
Lis docs/plan-projet.md section 3 (algorithme et cas limites) et les fichiers existants
de src/lib/scheduling. Implémente src/lib/scheduling/findMeetups.ts :
findMeetups(people, request, travelProvider) => Promise<MeetupProposal[]>.
Pour chaque jour de la requête et chaque lieu candidat P : pour chaque personne et chaque
fenêtre libre, disponibilité à P = [fin + trajet(lieuAvant→P) + marge,
début suivant − trajet(P→lieuAprès) − marge] ; intersection entre toutes les personnes ;
garder les intervalles ≥ minDurationMinutes. Remplir travelByPerson. Ne pas encore
classer (score = 0). Écris les tests de la section 3, dont le cas "pause de 1 h au cégep,
ami à 40 min : rien proposé chez l'ami". Garde la fonction pure (le provider est injecté).
```

---

### Segment 5 : Classement des propositions

**Objectif** : trier les propositions de la plus pratique à la moins pratique et éviter les doublons.

**Livrables**
- `score.ts` : `scoreProposal(p, weights)` avec poids exportés (durée, trajet total, équité du trajet, proximité dans le temps).
- `findMeetups` retourne les propositions triées, en gardant au plus N par jour et en retirant celles presque identiques.
- Option « appel/visio » quand aucune rencontre en personne n'est possible mais qu'il y a un trou commun (trajet = 0).

**Critères de fin**
- [ ] Entre « même lieu, 30 min » et « 15 min de trajet chacun, 30 min », le même lieu gagne.
- [ ] Pas deux propositions au même lieu qui se chevauchent à plus de 80 %.
- [ ] Tests passent.

**Prompt**
```
Lis docs/plan-projet.md section 3 (classement). Crée src/lib/scheduling/score.ts avec
scoreProposal(proposal, weights) et des DEFAULT_WEIGHTS exportés : plus long = mieux,
trajet total plus court = mieux, trajet réparti équitablement = mieux, plus tôt = un peu
mieux. Intègre-le dans findMeetups : trier par score, retirer les propositions au même
lieu qui se chevauchent à plus de 80 %, limiter à maxPerDay (option, défaut 3). Ajoute
un type de proposition "appel" (placeId null, trajets à 0) proposé seulement quand aucune
rencontre en personne n'est possible ce jour-là. Tests pour chaque règle.
```

> À ce stade, la logique complète fonctionne et est testée. Tout ce qui suit la branche à une vraie app.

---

### Segment 6 : Base de données et comptes

**Objectif** : chaque personne a un compte et ses données sont sauvegardées.

**Livrables**
- Projet Supabase relié (variables dans `.env.local`, `.env.example` commité).
- Schéma Drizzle : `profiles` (nom, mode de transport, lieu maison), `places`, `busy_blocks` (avec récurrence hebdomadaire possible), `groups`, `group_members`, `meetup_plans`, `plan_votes`.
- Connexion par courriel (lien magique) et Google.
- Row Level Security : chacun ne voit que ses données et celles de ses groupes.

**Critères de fin**
- [ ] On peut créer un compte, se connecter et se déconnecter.
- [ ] Les migrations s'appliquent sur une BD vide.
- [ ] Un utilisateur ne peut pas lire l'horaire d'un autre qui n'est pas dans un de ses groupes (testé).

**Prompt**
```
Lis docs/plan-projet.md sections 2 et 4, et src/lib/scheduling/types.ts. Branche
Supabase (Auth + Postgres) avec @supabase/ssr, et Drizzle ORM pour le schéma :
profiles (id = auth user id, display_name, travel_mode, home_place_id),
places (id, owner_id, name, lat, lng, is_group_favorite),
busy_blocks (id, owner_id, title, place_id, start_time, end_time, weekday nullable pour
les blocs hebdomadaires, valid_from, valid_until, source: 'manual'|'ics'|'image'),
groups (id, name, invite_code), group_members (group_id, user_id, role),
meetup_plans (id, group_id, place_id, start, end, status: 'proposed'|'confirmed'|'cancelled', created_by),
plan_votes (plan_id, user_id, vote: 'yes'|'no'|'maybe').
Écris les politiques RLS (un membre voit les données des membres de ses groupes, ne modifie
que les siennes). Pages /connexion avec lien magique et Google. Middleware qui protège
les pages sauf l'accueil. Crée .env.example et explique dans README.md comment créer le
projet Supabase et lancer les migrations. Écris une fonction de conversion
BD -> types de src/lib/scheduling (blocs hebdomadaires dépliés sur une plage de dates), avec tests.
```

---

### Segment 7 : Mes lieux

**Objectif** : chaque personne enregistre ses lieux (maison, cégep, travail…) et son mode de transport.

**Livrables**
- Page `/lieux` : ajouter, renommer, supprimer un lieu ; choisir la maison.
- Recherche d'adresse avec géocodage gratuit (Nominatim / OpenStreetMap, avec en-tête User-Agent et limite de 1 requête/s).
- Petite carte (Leaflet + OpenStreetMap) pour vérifier le point.
- Réglage du mode de transport dans le profil.
- Onboarding : à la première connexion, demander maison + cégep + mode de transport.

**Critères de fin**
- [ ] Je peux taper « Cégep Édouard-Montpetit » et le lieu est trouvé et placé sur la carte.
- [ ] Les lieux sont sauvegardés et rechargés.

**Prompt**
```
Lis docs/plan-projet.md et le schéma dans src/lib/db. Crée la page /lieux : liste de mes
lieux, ajout par recherche d'adresse (géocodage Nominatim via une route API serveur, avec
User-Agent identifiant l'app et limite 1 req/s), carte Leaflet/OpenStreetMap pour
confirmer le point, renommer, supprimer, définir comme maison. Ajoute le choix du mode
de transport dans un écran /profil. Ajoute un onboarding à la première connexion
(maison, cégep ou école, mode de transport). Interface en français, mobile d'abord.
```

---

### Segment 8 : Mon horaire (saisie manuelle)

**Objectif** : entrer son horaire de cours et ses autres engagements facilement.

**Livrables**
- Page `/horaire` : grille hebdomadaire (lundi à dimanche, 7 h à 23 h).
- Ajouter un bloc en cliquant/glissant sur la grille : titre, lieu (liste de mes lieux), récurrent chaque semaine ou ponctuel, dates de session (début/fin).
- Modifier/supprimer un bloc.
- Réglage « heures où je ne veux pas sortir » (ex. avant 9 h, après 22 h).

**Critères de fin**
- [ ] Je peux entrer une semaine complète de cours en moins de 5 minutes.
- [ ] Les blocs récurrents apparaissent chaque semaine de la session et pas après.
- [ ] Fonctionne sur téléphone.

**Prompt**
```
Lis docs/plan-projet.md. Crée la page /horaire : grille hebdomadaire lundi→dimanche,
7 h→23 h, par pas de 15 min. Clic-glisser pour créer un bloc ; formulaire : titre, lieu
(parmi mes lieux), hebdomadaire ou ponctuel, dates de début et fin de session pour les
hebdomadaires. Modifier et supprimer un bloc. Ajoute dans /profil les "heures où je ne
sors pas" (stockées et traitées comme des blocs occupés par la logique). Sur mobile,
afficher un jour à la fois avec onglets. Sauvegarde dans busy_blocks (source 'manual').
```

---

### Segment 9 : Import d'horaire .ics

**Objectif** : importer un horaire depuis un fichier calendrier (.ics), comme ceux de Google Agenda, Outlook ou certaines plateformes scolaires.

**Livrables**
- `src/lib/import/ics.ts` : parseur (bibliothèque `node-ical` ou `ical.js`) qui gère les événements récurrents (RRULE) et les exceptions.
- Écran d'import : téléverser le fichier, **aperçu** des cours détectés, associer chaque « LOCATION » à un de mes lieux (ou en créer un), confirmer.
- Ré-import sans doublons (remplace les blocs `source = 'ics'`).

**Critères de fin**
- [ ] Un .ics de test avec cours hebdomadaires + une semaine de relâche est importé correctement.
- [ ] Rien n'est sauvegardé avant que je confirme l'aperçu.
- [ ] Tests du parseur passent.

**Prompt**
```
Lis docs/plan-projet.md. Crée src/lib/import/ics.ts : parse un fichier .ics (utilise
ical.js ou node-ical) en blocs { title, start, end, weekday?, validFrom, validUntil,
locationText }, en gérant RRULE, EXDATE et le fuseau America/Toronto. Tests Vitest avec
un .ics d'exemple (cours hebdomadaires, une semaine de relâche exclue). Puis ajoute dans
/horaire un bouton "Importer un fichier .ics" : téléversement, aperçu des blocs,
association de chaque locationText distinct à un lieu existant ou nouveau, confirmation.
Le ré-import remplace les blocs source='ics' existants. Rien n'est écrit avant confirmation.
```

---

### Segment 10 : Groupes et amis

**Objectif** : créer un groupe d'amis et inviter les autres.

**Livrables**
- Page `/groupes` : créer un groupe, voir mes groupes.
- Lien d'invitation (code) à partager ; rejoindre via le lien.
- Liste des membres ; quitter un groupe ; l'admin peut retirer un membre.
- Lieux favoris du groupe (café, parc…).
- Confidentialité : les autres voient **« occupé »** et le lieu général, pas le titre des cours (option).

**Critères de fin**
- [ ] Avec deux comptes, je crée un groupe, j'envoie le lien, l'autre rejoint.
- [ ] Un non-membre ne peut ni voir ni rejoindre sans le lien.

**Prompt**
```
Lis docs/plan-projet.md et le schéma BD. Crée /groupes (liste + création) et
/groupes/[id] (membres, lien d'invitation copiable, quitter, retirer un membre pour
l'admin). Route /rejoindre/[code] qui ajoute l'utilisateur connecté au groupe.
Ajoute les lieux favoris du groupe (places.is_group_favorite + lien au groupe).
Ajoute un réglage de confidentialité : les membres voient "Occupé" au lieu du titre des
blocs (par défaut activé). Vérifie les politiques RLS avec deux comptes de test.
```

---

### Segment 11 : Vue « quand on peut se voir »

**Objectif** : l'écran principal. Pour un groupe, voir les propositions réalistes de la semaine.

**Livrables**
- Dans `/groupes/[id]` : choisir qui participe, la période (cette semaine / semaine prochaine), la durée minimale (30 min, 1 h, 2 h…).
- Appel serveur à `findMeetups` avec les vraies données.
- Liste des propositions classées : jour, heure, lieu, durée, trajet de chacun (« ali : 0 min, Sam : 12 min »).
- Vue grille optionnelle qui superpose les disponibilités.
- Message clair quand rien n'est possible (« Pas de moment réaliste cette semaine, voici un appel possible mardi 12 h »).

**Critères de fin**
- [ ] Avec les horaires de test, les propositions affichées correspondent à ce que les tests du segment 4 prédisent.
- [ ] Le scénario « pause de 1 h, ami à Montréal » ne propose pas Montréal.
- [ ] Le calcul répond en moins de 2 s pour 5 personnes sur une semaine.

**Prompt**
```
Lis docs/plan-projet.md et src/lib/scheduling. Dans /groupes/[id], ajoute la section
"Quand on peut se voir" : sélection des participants, période (cette semaine / la
suivante), durée minimale (30, 45, 60, 90, 120 min), marge (défaut 5 min). Une server
action charge les profils, lieux et blocs (convertis avec la fonction du segment 6),
appelle findMeetups avec EstimatedTravelProvider et renvoie les propositions. Affiche
des cartes : jour, heures, lieu, durée, trajet de chaque personne. Si rien n'est
possible, l'expliquer et montrer la proposition "appel" si elle existe. Ajoute un test
d'intégration qui vérifie le cas "pause de 1 h au cégep, ami à 40 min". Mesure le temps de
calcul et optimise si > 2 s pour 5 personnes.
```

---

### Segment 12 : Plan d'action (proposer, voter, confirmer)

**Objectif** : transformer une proposition en vrai plan que le groupe accepte.

**Livrables**
- Bouton « Proposer ce moment » sur une proposition : crée un `meetup_plan` (statut `proposed`).
- Chaque membre vote oui / non / peut-être.
- Confirmé automatiquement quand tous les participants disent oui (ou manuellement par celui qui propose).
- Page « Mes plans » : à venir, en attente de vote, passés.
- Export d'un plan confirmé en .ics (« Ajouter à mon agenda »).
- Si quelqu'un modifie son horaire et que le plan devient impossible, le plan est marqué « à revoir ».

**Critères de fin**
- [ ] Parcours complet avec deux comptes : proposer, voter, confirmé, ajouté à l'agenda.
- [ ] Un plan confirmé est traité comme un bloc occupé pour les calculs suivants.

**Prompt**
```
Lis docs/plan-projet.md. Ajoute le plan d'action : bouton "Proposer ce moment" sur
chaque proposition (crée meetup_plans status 'proposed') ; votes oui/non/peut-être
(plan_votes) ; passage à 'confirmed' quand tous les participants votent oui ou quand le
créateur confirme ; page /plans (à venir, en attente, passés) ; bouton "Ajouter à mon
agenda" qui télécharge un .ics. Les plans confirmés comptent comme blocs occupés dans
findMeetups. Quand un participant modifie son horaire, revalider ses plans confirmés à
venir avec la logique de findMeetups et marquer "à revoir" ceux qui ne sont plus faisables.
```

### Segment 13 : Planificateur d'étude, la logique

**Objectif** : à partir des examens et travaux d'une personne, calculer des séances d'étude réalistes dans ses moments libres.

**Livrables**
- Types `Deadline`, `StudySession`, `StudyPreferences` dans `types.ts`.
- `studyPlanner.ts` : `planStudySessions(person, deadlines, prefs, travelProvider, now)` qui retourne `{ sessions, warnings }`, en suivant la section 3 bis.
- Table `deadlines` (owner_id, type, course, due_at, estimated_hours, difficulty) et `busy_blocks.source` accepte `'study'`, avec un champ `movable` et `deadline_id`.

**Critères de fin**
- [ ] Les quatre cas limites de la section 3 bis ont un test qui passe.
- [ ] Le maximum par jour et la durée min/max d'une séance sont respectés (testés).
- [ ] Les séances ne chevauchent jamais un bloc occupé, ni le trajet pour s'y rendre.

**Prompt**
```
Lis docs/plan-projet.md section 3 bis et les fichiers de src/lib/scheduling. Ajoute les
types Deadline, StudySession et StudyPreferences, puis implémente
src/lib/scheduling/studyPlanner.ts : planStudySessions(person, deadlines, prefs,
travelProvider, now) => Promise<{ sessions, warnings }>. Réutilise getFreeWindows et le
calcul d'arrivée/départ de findMeetups (extrais une fonction commune si besoin, sans
casser les tests existants). Séances au lieu où la personne est déjà ; durée entre
prefs.minSessionMinutes et prefs.maxSessionMinutes ; au plus prefs.maxStudyMinutesPerDay ;
répartition espacée avec plus de poids les 2-3 jours avant l'échéance et une courte
révision la veille ; échéances triées par date puis par charge ; warning avec les heures
manquantes si le temps libre ne suffit pas ; garder prefs.keepFreeRatio du temps libre.
Écris les tests des cas limites de la section 3 bis. Ajoute ensuite au schéma Drizzle la
table deadlines et, dans busy_blocks, source 'study', movable (bool) et deadline_id,
avec migration et politiques RLS (seul le propriétaire voit ses échéances).
```

---

### Segment 14 : Planificateur d'étude, l'interface

**Objectif** : entrer un examen et voir les séances proposées apparaître dans son horaire.

**Livrables**
- Page `/etude` : ajouter un examen ou un travail (cours, date et heure, heures estimées ou difficulté).
- Bouton « Planifier mon étude » : affiche les séances proposées dans la grille de `/horaire`, en couleur distincte et en pointillé.
- Accepter tout, accepter une séance, la refuser ou la déplacer (glisser) ; les séances acceptées deviennent des blocs `source = 'study'`.
- Avertissements visibles (« il te manque 2 h avant l'examen de chimie »).
- Si l'horaire change ou qu'un plan de groupe est confirmé par-dessus une séance déplaçable, proposer de replanifier.
- Préférences d'étude dans `/profil`.

**Critères de fin**
- [ ] J'entre un examen mardi, je clique sur « Planifier », les séances apparaissent dans mon horaire et je peux les accepter.
- [ ] Une séance acceptée bloque bien ce moment dans la recherche de rencontres.
- [ ] Une rencontre confirmée par-dessus une séance déplaçable déclenche une proposition de déplacement.

**Prompt**
```
Lis docs/plan-projet.md section 3 bis et src/lib/scheduling/studyPlanner.ts. Crée la page
/etude : liste et ajout d'examens/travaux (table deadlines). Bouton "Planifier mon
étude" : une server action appelle planStudySessions avec les vraies données et affiche
les séances proposées dans la grille de /horaire (couleur distincte, bordure pointillée)
sans les sauvegarder. Actions : tout accepter, accepter/refuser une séance, la déplacer
par glisser-déposer (revalidée côté serveur). Les séances acceptées sont écrites dans
busy_blocks (source 'study', movable true par défaut, deadline_id). Affiche les warnings.
Ajoute les préférences d'étude dans /profil. Quand un meetup_plan est confirmé par-dessus
une séance déplaçable, ou quand l'horaire change, proposer de replanifier les séances
touchées. Interface en français, mobile d'abord.
```

---

> **À ce point, l'app de base est complète.** Les segments suivants l'améliorent.

---

### Segment 15 : Vrai temps de trajet (API)

**Objectif** : remplacer l'estimation par de vrais temps de trajet, sans casser le reste.

**Livrables**
- `OpenRouteServiceProvider` (marche, vélo, auto) implémentant `TravelTimeProvider`.
- Pour le transport en commun : garder l'estimation améliorée, ou Google Distance Matrix si une clé est fournie (variable d'environnement facultative).
- Cache en BD (`travel_cache`: from, to, mode, minutes, date) valable 30 jours.
- Repli automatique sur l'estimation si l'API échoue.

**Critères de fin**
- [ ] Sans clé d'API, tout fonctionne comme avant.
- [ ] Avec une clé, les temps affichés sont ceux de l'API.
- [ ] Les tests du cœur passent toujours (ils utilisent un faux provider).

**Prompt**
```
Lis docs/plan-projet.md et src/lib/scheduling/travel.ts. Crée dans src/lib/travel un
OpenRouteServiceProvider (ORS_API_KEY) pour walk/bike/car et un GoogleTransitProvider
facultatif (GOOGLE_MAPS_API_KEY) pour transit. Ajoute un CachedTravelProvider qui
stocke les résultats dans une table travel_cache (30 jours) et un FallbackTravelProvider
qui retombe sur EstimatedTravelProvider en cas d'erreur ou sans clé. Utilise une
"matrix" quand l'API le permet pour limiter les appels. Mets à jour .env.example et le
README. Aucun changement dans findMeetups.
```

---

### Segment 16 : Import d'horaire par capture d'écran ou PDF

**Objectif** : importer son horaire Omnivox (ou autre) en téléversant une capture d'écran ou un PDF.

**Livrables**
- Route serveur qui envoie l'image/PDF à l'API Claude et demande une sortie JSON structurée (cours, jour, heures, local/pavillon).
- Validation du JSON (zod) puis **même écran d'aperçu** que l'import .ics.
- Clé `ANTHROPIC_API_KEY` côté serveur seulement ; limite de taille et de nombre d'imports par jour.

**Critères de fin**
- [ ] Une capture d'écran d'horaire Omnivox typique donne un aperçu correct à corriger au besoin.
- [ ] L'utilisateur peut corriger chaque bloc avant de confirmer.
- [ ] Rien ne part vers l'API sans action de l'utilisateur.

**Prompt**
```
Lis docs/plan-projet.md et src/lib/import. Ajoute l'import par image ou PDF : route API
serveur qui envoie le fichier à l'API Claude (SDK @anthropic-ai/sdk, modèle Claude récent
qui lit les images, ANTHROPIC_API_KEY côté serveur) avec une consigne demandant un JSON
{ courses: [{ title, weekday (1-7), start "HH:MM", end "HH:MM", room?, building? }] }.
Valide avec zod, puis réutilise l'écran d'aperçu de l'import .ics (avec édition de
chaque bloc avant confirmation, source='image'). Limite : 10 Mo, 5 imports/jour/personne.
Gère proprement les erreurs (image illisible, JSON invalide).
```

---

### Segment 17 : Déploiement

**Objectif** : mettre l'app en ligne pour que tes amis l'utilisent.

**Livrables**
- Déploiement sur Vercel relié au repo GitHub (déploiement à chaque push sur `main`).
- Variables d'environnement de production ; URL de redirection Supabase mises à jour.
- GitHub Actions : `lint`, `test`, `build` sur chaque PR.

**Critères de fin**
- [ ] L'app est accessible par une URL publique.
- [ ] Connexion, groupe, horaire et propositions fonctionnent en production.
- [ ] Le CI bloque une PR si les tests échouent.

**Prompt**
```
Lis docs/plan-projet.md. Prépare le déploiement : workflow GitHub Actions (npm ci, lint,
test, build) sur les PR et sur main ; instructions dans README.md pour déployer sur
Vercel, configurer les variables d'environnement et les URL de redirection Supabase
(Auth > URL configuration). Vérifie que npm run build passe sans variable facultative.
```

---

### Segment 18 : Finition (bonus)

Idées à traiter une à la fois, chacune comme un mini-segment :
- **PWA** : installable sur le téléphone (manifest, icône).
- **Notifications** : courriel ou push quand un plan est proposé ou confirmé.
- **« Je suis libre maintenant »** : bouton qui cherche qui peut se voir dans les 2 prochaines heures.
- **Disponibilités ponctuelles** : « ce samedi je suis libre de 13 h à 18 h ».
- **Mode sombre**, accessibilité, traduction anglaise.

Prompt type :
```
Lis docs/plan-projet.md. Implémente le bonus "<nom>" décrit au segment 18. Respecte les
règles de CLAUDE.md, ajoute des tests si de la logique est touchée, et vérifie
npm test, npm run lint, npm run build.
```

---

## 7. Conseils pour travailler avec Claude Code

- **Un segment = une conversation = un commit.** Si une conversation devient longue ou confuse, recommence-la ; le plan et `CLAUDE.md` redonnent le contexte.
- **Demande-lui de planifier d'abord** pour les gros segments (4, 6, 11, 12, 13) : ajoute « Commence par me montrer ton plan avant de coder » au prompt.
- **Vérifie les critères de fin toi-même.** Lance l'app, clique, essaie les cas bizarres.
- **Si un bug apparaît dans la logique**, demande d'abord un test qui le reproduit, puis la correction.
- **Ne mets jamais de clé d'API dans le code** ; seulement dans `.env.local` (jamais commité).
- **Mets à jour ce plan** si tu changes d'idée (ex. autre stack) : c'est la mémoire du projet pour Claude Code.
