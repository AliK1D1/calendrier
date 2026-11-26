# Jeux de données de Freecrew

Ces jeux de données servent à vérifier les **principes fondamentaux** de Freecrew : trouver du
temps libre commun **réaliste** entre amis (trajets, lieux, durée minimale, heures où l'on ne
sort pas, plans déjà acceptés). Chaque scénario provoque exprès une réussite, un cas limite ou
une erreur.

- **Les données** : `src/lib/testdata/freecrew.ts` (10 personnes, leurs lieux, leurs horaires,
  10 groupes, 3 plans). Elles sont écrites comme des lignes de la base de données, avec des jours
  relatifs à une semaine (lundi = jour 0), puis datées par `materialize(lundi)`.
- **Les tests** : `src/lib/scheduling/__tests__/scenarios.test.ts` (S01 à S28) et
  `scenarios-groupe.test.ts` (S29 à S41, « qui est disponible dans un groupe »). Chaque bloc de
  tests porte le numéro du scénario (S01, S02…). Les données passent par le même chemin que dans l'app :
  lignes de la BD → `toPeople` → logique d'horaire.
- **Le seed** : `scripts/seed-test-data.mjs` remplit une base Supabase **de test** avec les mêmes
  personnes, pour essayer les scénarios à la main (voir « Essayer à la main » en bas). Il est
  vérifié dans `src/lib/db/__tests__/seed.test.ts` sur une base Postgres en mémoire.

Semaine des tests : du lundi 23 au dimanche 29 novembre 2026. Les heures sont celles de
Montréal (America/Toronto). La règle d'or vérifiée dans presque tous les scénarios : **une
proposition ne demande jamais à quelqu'un d'être à deux endroits** (cours, trajet et marge de
5 min compris).

## La bande

| Personne  | Se déplace          | Habite                   | Particularité                                                                     |
| --------- | ------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| **ali**   | transport en commun | Vieux-Longueuil          | Cours au Cégep Édouard-Montpetit, cinéma accepté samedi 19 h                      |
| **Sam**   | vélo                | Saint-Lambert            | Même cégep qu'ali, deux cours qui se chevauchent le jeudi                         |
| **Maya**  | transport en commun | Plateau-Mont-Royal       | Cours à l'Université de Montréal                                                  |
| **Léo**   | auto                | Chomedey (Laval)         | Travaille au Carrefour Laval, même le dimanche                                    |
| **Nora**  | à pied              | Longueuil, près du cégep | **Horaire vide** : libre tout le temps                                            |
| **Zoé**   | transport en commun | —                        | **Aucune maison choisie** (profil incomplet)                                      |
| **Félix** | à pied              | **Sherbrooke**           | Tout trajet vers Longueuil est trop long                                          |
| **Jade**  | transport en commun | Longueuil                | **Ne sort pas avant 10 h ni après 20 h**, **une sortie par jour** au plus         |
| **Hugo**  | auto                | Brossard                 | **Quart de nuit** du vendredi 22 h au samedi 6 h                                  |
| **Lina**  | transport en commun | Verdun                   | Récurrences personnalisées, cours annulé, disponibilité ponctuelle, lieu supprimé |

### Horaires de la semaine

- **ali** : lun. 8 h-10 h et 13 h-16 h · mar. 8 h-12 h et 12 h 45-15 h · mer. 8 h-10 h et
  13 h-15 h · jeu. 10 h-12 h · ven. 8 h-15 h (tout au cégep).
- **Sam** : lun. 8 h-11 h et 13 h-15 h · mar. 8 h-12 h et 12 h 45-17 h · jeu. 8 h-11 h
  **et** 10 h-12 h (chevauchement) · jeudi 17 h-21 h : quart de travail ajouté **après** le
  souper accepté.
- **Maya** : lun. 8 h 30-11 h 30 · mer. 8 h-10 h et 13 h-16 h (à l'UdeM).
- **Léo** : travail lun. et mer. 12 h-20 h · ven. 15 h-22 h · sam. 10 h-18 h · dim. 11 h-17 h.
- **Hugo** : ven. 22 h-24 h et sam. 0 h-6 h, à l'Hôpital Charles-LeMoyne.
- **Lina** : travail sam. 9 h-17 h · club d'échecs jeu. 18 h-20 h **une semaine sur deux** ·
  cours de dessin mer. 9 h-12 h (**annulé cette semaine**) · dentiste **chaque mois** le 24,
  15 h-16 h, dans un lieu qu'elle a **supprimé** · **disponible samedi 13 h-16 h** malgré le
  travail.

### Groupes et plans

| Groupe                 | Membres             |
| ---------------------- | ------------------- |
| Pauses du cégep        | ali, Sam            |
| ali et Maya            | ali, Maya           |
| ali et Léo             | ali, Léo            |
| Trop loin (Félix)      | ali, Félix          |
| Les quatre             | ali, Sam, Maya, Léo |
| Juste moi              | ali (seul)          |
| Avec Zoé (sans maison) | ali, Zoé            |
| Jade et Nora           | Nora, Jade          |
| Lina et Nora           | Nora, Lina          |
| Hugo et Nora           | Nora, Hugo          |
| Toute la bande         | les 10              |

- **Souper au café** (Pauses du cégep) : jeudi 18 h-20 h au café rue Saint-Charles, proposé
  par ali, accepté par Sam.
- **Marche au parc** (Jade et Nora) : dimanche 14 h-16 h, proposée par Nora, acceptée par Jade.
- **Cinéma** (Les quatre) : samedi 19 h-21 h 30, proposé par ali, accepté par Maya, refusé par
  Léo.

## Les scénarios

Légende : ✅ réussite · ⚠️ cas limite · ❌ erreur attendue.

### Trouver un moment commun

**S01 · ali et Sam se voient au cégep entre deux cours** ✅
Lundi, les deux sont au cégep et libres de 11 h à 13 h. Attendu : une rencontre au cégep de
11 h à 13 h, **sans trajet** (0 min pour les deux), car ils sont déjà sur place. Ali et Sam ont
chacun enregistré « leur » cégep : Freecrew reconnaît que c'est le même endroit.

**S02 · ali et Léo n'ont aucun moment commun le vendredi** ❌ (aucun résultat)
Ali a des cours de 8 h à 15 h, Léo travaille de 15 h à 22 h. Attendu : aucune proposition, même
pas un appel, et rien à expliquer.

**S03 · ali et Maya : le trajet mange le temps libre du mercredi matin** ⚠️ (presque)
Les deux sont libres de 10 h à 13 h, mais ali est au cégep (Longueuil) et Maya à l'UdeM. Pour
2 h ensemble : impossible en personne, Freecrew propose **un appel de 10 h à 13 h**.
L'explication « presque » montre 1 h 33 possible **chez Maya** (10 h 46 à 12 h 19), dit
qu'**ali** est limitée par **son trajet** (41 min aller, 36 min retour, plus la marge), et
propose de **raccourcir à 1 h 30**. Avec 1 h 30, la rencontre chez Maya apparaît.
(Dans les tests, on cherche seulement avant 13 h ; dans l'app, regarde le mercredi matin.)

**S04 · Félix habite à Sherbrooke et marche : trajet trop long** ⚠️
Samedi, ali et Félix sont libres, mais le trajet à pied fait plus d'une journée. Attendu :
**seulement un appel**, de 8 h à 19 h (ali va au cinéma à 19 h).

**S05 · Nora a un horaire vide** ✅
Nora a une seule fenêtre libre, de 8 h à 22 h. Avec ali le lundi, il y a des rencontres en
personne, toutes en dehors des cours d'ali (trajets compris).

**S06 · groupe d'une seule personne** ⚠️ / ❌
Le groupe « Juste moi ». Attendu : rien à expliquer et pas de « libre maintenant » (il faut être
au moins deux). Une personne inconnue dans une recherche donne une erreur claire
(« Personne inconnue »).

**S07 · Zoé n'a pas choisi de maison** ⚠️ (profil incomplet)
Sans maison, impossible de calculer ses trajets. Attendu : Zoé est mise de côté avec la raison
« pas de maison » (l'app lui demande d'en choisir une), les autres sont calculés normalement.

**S08 · Sam a deux cours qui se chevauchent le jeudi** ⚠️
8 h-11 h et 10 h-12 h. Attendu : les deux blocs sont fusionnés (occupé de 8 h à 12 h), la
première fenêtre libre commence à midi, et l'écran « horaire » signale le chevauchement.

**S09 · Hugo travaille de nuit, de part et d'autre de minuit** ⚠️
Un bloc vendredi 22 h-24 h et un bloc samedi 0 h-6 h. Attendu : « 24:00 » veut dire minuit pile,
la nuit reste occupée (libre 20 h-22 h, puis à partir de 6 h). Un bloc qui traverse minuit
(22 h → 2 h) est refusé par le formulaire : il faut deux blocs.

**S10 · changement d'heure** ⚠️
Semaine du 26 octobre 2026 (retour à l'heure normale le dimanche 1er novembre). Attendu : le
travail de Léo reste à **11 h** le dimanche (l'heure UTC change, pas l'heure locale), ce
dimanche dure **25 h** (19 h libres + 6 h de travail). Au printemps (8 mars 2026, 23 h),
« je ne sors pas avant 10 h » ne dure que 9 h.

**S11 · Jade ne sort pas avant 10 h ni après 20 h** ✅
Avec Nora le samedi : toutes les propositions sont entre 10 h et 20 h.

**S12 · Jade a déjà sa sortie du dimanche** ⚠️ (limite de sorties)
Jade accepte au plus une sortie par jour, et a accepté la marche de dimanche. Attendu : plus
rien n'est proposé avec Jade ce dimanche ; le samedi, la limite ne bloque rien.

**S13 · Lina : club d'échecs une semaine sur deux, dentiste chaque mois** ✅
Le club a lieu cette semaine, pas la suivante, puis de nouveau la semaine d'après. Le dentiste
du 24 novembre revient le 24 décembre.

**S14 · le cours de dessin de Lina est annulé cette semaine** ✅
« Annuler cette fois-ci » : pas de cours ce mercredi, mais il revient mercredi prochain.

**S15 · Lina se rend disponible samedi de 13 h à 16 h, pendant son travail** ✅
La disponibilité ponctuelle passe avant le travail, et le reste de la journée compte comme
occupé. Avec Nora : tout se passe entre 13 h et 16 h.

**S16 · le lieu du dentiste a été supprimé** ⚠️
Le bloc reste, et Freecrew le compte à la maison de Lina au lieu de planter.

**S17 · durée minimale : 45 min de pause commune le mardi midi** ⚠️
Ali et Sam sont libres de 12 h à 12 h 45 au cégep (on cherche entre 8 h et 17 h). Avec 30 min :
une rencontre de 12 h à 12 h 45. Avec 1 h : rien, et l'explication propose de raccourcir à
45 min. Une durée nulle ou invalide est une erreur.

**S18 · « Qui est libre maintenant ? »** ✅ / ⚠️
Lundi 11 h 05 : ali et Sam peuvent se voir au cégep dès 11 h 15 (arrondi au quart d'heure),
jusqu'à 13 h. Lundi 21 h 50 : trop tard, la journée finit à 22 h. Vendredi 13 h : ali est en
cours, donc rien avec Léo.

### Plans

**S19 · le souper accepté devient « à revoir »** ⚠️
Ali et Sam ont accepté le souper de jeudi 18 h-20 h. Ensuite, Sam reçoit un quart de travail
17 h-21 h. Attendu : avant le quart, aucun conflit (le bloc du plan lui-même ne compte pas) ;
après, **Sam** est signalé (2 h de conflit), pas ali. Le souper compte aussi comme occupé dans
les recherches (jeudi 18 h-20 h, plus rien pour ali et Sam).

**S20 · proposer un plan : formulaire valide et erreurs** ✅ / ❌
Jeudi 18 h pour 2 h : accepté. Refusés : un moment déjà passé, moins de 15 min, plus de 12 h,
un plan qui passe minuit, une liste d'invités vide.

**S21 · plan récurrent partagé (le gym chaque semaine)** ✅ / ❌
« Chaque semaine, sans fin » : accepté. Refusés : « tous les 0 », une fin avant la première
fois, une fin dans plus de 10 ans.

**S22 · planificateur d'étude d'ali** ✅ / ⚠️
Examen de chimie jeudi 10 h, 4 h d'étude, on est lundi 7 h : 4 h de séances placées avant
l'examen, jamais pendant un cours. Examen de physique mardi 8 h avec 10 h à faire, lundi
16 h : avertissement « il te manque … ». Examen déjà passé : avertissement, aucune séance.

### Import, trajets et lieux

**S23 · import d'un horaire .ics** ✅ / ❌
Un cours chaque lundi (8 h-10 h) devient un bloc hebdomadaire, avec son lieu. Un texte qui n'est
pas un calendrier est refusé sans planter. Un calendrier sans événement donne un aperçu vide.
Un fichier trop gros (plus de 1 Mo) est refusé.

**S24 · l'API de trajets tombe en panne** ⚠️
Avec une API en panne ou trop lente (délai dépassé), Freecrew utilise l'estimation maison et
compte l'échec ; avec une API qui répond, son temps est utilisé (arrondi à la minute
supérieure).

**S25 · lieu aux coordonnées impossibles** ❌
Un lieu à la latitude 200 donne une erreur claire (« Coordonnées invalides ») au lieu de faire
disparaître la personne des résultats en silence.

**S26 · recherche d'une adresse introuvable** ⚠️ / ❌
Aucune réponse : liste vide (l'écran dit « introuvable »). Service en panne : erreur
« indisponible ».

**S27 · formulaire de bloc invalide** ❌
Refusés : fin avant le début, titre vide, titre de plus de 100 caractères, aucun jour coché,
session à l'envers.

**S28 · « Les quatre » sur toute la semaine** ✅
Ali, Sam, Maya et Léo du lundi au dimanche, 1 h minimum. Attendu : au plus 3 propositions par
jour, de la meilleure à la moins bonne, chacune avec les trajets des quatre, et toutes
réalistes.

### Qui est disponible dans un groupe

Le plan de test complet de cette fonctionnalité est dans `docs/plan-test-disponibilite-groupe.md`.
Trois vues : la **grille** (qui est libre, par demi-heure, **sans** les trajets), la
**recherche du groupe** (moments réalistes, trajets compris) et **« Je suis libre
maintenant »** (qui peut me voir d'ici 2 h, dans tous mes groupes).

**S29 · grille de « Les quatre » le lundi** ✅
28 tranches de 8 h à 22 h. À 8 h 30 seul Léo est libre ; à 11 h, ali, Sam et Léo (Maya finit à
11 h 30) ; de **11 h 30 à 12 h, les quatre** ; à 13 h, seulement Maya ; dès 20 h, les quatre.
Une tranche coupée par un cours ne compte pas.

**S30 · la grille dit « tous libres », mais les trajets disent non** ⚠️
Lundi 11 h 30-12 h, les quatre sont libres sur la grille, mais Maya est à l'UdeM, ali et Sam au
cégep, Léo commence à Laval à midi. Attendu : **aucune rencontre en personne**, seulement des
appels (11 h 30-12 h et 20 h-22 h).

**S31 · tout le monde est libre** ✅
Hugo et Nora le mercredi : les 28 tranches. « Les quatre » le dimanche : tous libres de 8 h à
11 h et de 17 h à 22 h ; les rencontres en personne sont le soir (Léo arrive de Laval après
17 h), toutes réalistes.

**S32 · personne n'est libre** ❌ (aucun résultat)
Ali, Sam et Maya lundi 9 h-10 h : tranches vides. « Les quatre » vendredi : jamais les quatre en
même temps ; aucune proposition, même pas un appel.

**S33 · une partie du groupe seulement, et membres étrangers** ✅ / ❌
Dans « Les quatre », ali choisit ali, Sam et Maya : Léo n'apparaît nulle part (ni grille, ni
trajets). Un participant hors du groupe (Nora) : « Un des participants ne fait pas partie du
groupe. » Nora qui regarde « Les quatre » : « Groupe introuvable. »

**S34 · heures calmes et limite de sorties dans la grille** ⚠️
Samedi, Jade n'est pas libre avant 10 h ni après 20 h. Dimanche, elle a déjà sa sortie (la
marche) : libre dans **aucune** tranche ; de 14 h à 16 h, personne (Nora est à la marche aussi).

**S35 · récurrence et disponibilité ponctuelle dans la grille** ✅
Samedi, Lina est libre seulement de 13 h à 16 h. Jeudi 18 h : occupée cette semaine (club
d'échecs), libre la semaine suivante.

**S36 · un membre sans maison dans le groupe** ⚠️
« Avec Zoé » : Zoé est écartée (« n'a pas encore choisi son lieu « maison » »), ali reste seul :
pas de grille, pas de proposition.

**S37 · « libre maintenant » ne fait jamais partir quelqu'un dans le passé** ⚠️ (bogue corrigé)
Lundi 11 h 05, Nora (à 9 min à pied) arrive au cégep à **11 h 29** (départ 11 h 15 + 9 min +
5 min de marge), pas à 11 h 15. Avant la correction, l'app proposait 11 h 15 à Hugo, Lina et
Maya aussi, comme s'ils étaient partis de chez eux avant même qu'on les appelle. Pour chaque
rencontre en personne : début ≥ maintenant (arrondi au quart d'heure) + trajet + marge.

**S38 · « libre maintenant » dans tous mes groupes (Toute la bande)** ✅
Lundi 11 h 05 : 8 personnes essayées, Zoé nommée à part (sans maison), Félix en appel seulement,
Sam en tête (déjà au cégep) avec ses 3 groupes en commun, liste du plus tôt au plus tard. Nora
dimanche midi : Jade n'est pas proposée (sortie du jour déjà prise). Vendredi 21 h 30 :
seulement des appels de 21 h 30 à 22 h, sans Léo (au travail).

**S39 · « libre maintenant » : un seul groupe, et les refus** ✅ / ❌
Seulement « Pauses du cégep » : Sam. Un groupe dont ali n'est pas membre : « Groupe
introuvable. » Zoé (sans maison) : on lui demande de choisir sa maison. Lundi 22 h 30 : liste
vide.

**S40 · « Toute la bande » sur la semaine** ⚠️
Zoé écartée, 9 participants. Félix (Sherbrooke, à pied) empêche toute rencontre en personne :
seulement des appels. Grille de 7 jours × 28 tranches, calcul en moins de 2 s. Sans Félix ni
Zoé : des rencontres en personne, réalistes pour les 8.

**S41 · grille du groupe au changement d'heure** ⚠️
Dimanche 1er novembre 2026 (25 h) : toujours 28 tranches de 8 h à 22 h, et Léo est occupé de
11 h à 17 h, heure locale.

## Essayer à la main (base Supabase de test)

Le script crée les 10 comptes, leurs lieux et horaires, les groupes et les plans, datés pour
**la semaine du prochain lundi**. Il ne touche **jamais** la base de l'app :

- il lit des variables à part (`SEED_SUPABASE_URL`, `SEED_SUPABASE_ANON_KEY`), pas celles de
  l'app, et refuse l'adresse de `NEXT_PUBLIC_SUPABASE_URL` ;
- il faut retaper l'identifiant du projet de test (`--base-de-test=<ref>`) ;
- il utilise seulement la clé publique « anon » (il refuse une clé secrète) : chaque compte
  s'inscrit, puis écrit ses propres données avec sa session, par les mêmes fonctions SQL que
  l'app (RLS) ;
- aucune clé n'est dans le dépôt.

Étapes :

1. Crée un **deuxième projet** Supabase (gratuit), par exemple « freecrew-test ». Dans le SQL
   Editor, colle `supabase/setup.sql` et lance-le.
2. Authentication → Sign In / Providers → Email : désactive **Confirm email** (comme sur la
   vraie base).
3. Dans un terminal, dans `FreecrewWeb` :

   ```bash
   SEED_SUPABASE_URL=https://<ref>.supabase.co \
   SEED_SUPABASE_ANON_KEY=<clé anon du projet de test> \
   SEED_PASSWORD='<un mot de passe, ex. Test1234>' \
   npm run seed:test -- --base-de-test=<ref>
   ```

   (Node 22.18 ou plus récent.) Pour relancer sur la même base, ajoute `--tag=b` : de nouveaux
   comptes sont créés à côté des premiers.

4. Pour voir l'app sur la base de test, lance `npm run dev` avec, dans `.env.local`, l'adresse
   et la clé anon **du projet de test** (garde une copie de tes vraies valeurs).
5. Connecte-toi, par exemple, avec `freecrew.ali@example.com` et ton `SEED_PASSWORD`. Les
   comptes sont `freecrew.<nom>@example.com` : ali, sam, maya, leo, nora, zoe, felix, jade,
   hugo, lina.

Quoi regarder dans l'app :

| Compte | Où                                            | Scénario                                |
| ------ | --------------------------------------------- | --------------------------------------- |
| ali    | Groupe « Pauses du cégep », lundi             | S01 (cégep 11 h-13 h), S17 (mardi midi) |
| ali    | Groupe « ali et Léo », vendredi               | S02 (rien)                              |
| ali    | Groupe « ali et Maya », mercredi matin, 2 h   | S03 (presque, compromis)                |
| ali    | Groupe « Trop loin (Félix) », samedi          | S04 (appel seulement)                   |
| ali    | Groupe « Avec Zoé (sans maison) »             | S07 (Zoé doit choisir une maison)       |
| ali    | Plans : « Souper au café »                    | S19 (à revoir : Sam n'est plus libre)   |
| ali    | Groupe « Juste moi »                          | S06                                     |
| nora   | Groupe « Jade et Nora », samedi puis dimanche | S11, S12                                |
| nora   | Groupe « Lina et Nora », samedi               | S15                                     |
| hugo   | Horaire du vendredi et du samedi              | S09                                     |
| lina   | Horaire (deux semaines, mercredi, le 24)      | S13, S14, S16                           |
| ali    | Étude : ajoute un examen                      | S22                                     |
| ali    | Groupe « Les quatre », grille, lundi          | S29, S30, S32                           |
| ali    | Groupe « Toute la bande »                     | S36, S40                                |
| ali    | Accueil, « Je suis libre maintenant »         | S37, S38, S39 (à l'heure du scénario)   |
| nora   | Groupe « Jade et Nora », grille               | S34                                     |
