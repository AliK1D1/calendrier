# Plan de test : « Qui est disponible dans un groupe ? »

Ce plan couvre la fonctionnalité qui montre **qui, dans un groupe, est libre et quand**, sur le
site et dans l'app mobile. Les jeux de données sont ceux de `src/lib/testdata/freecrew.ts`
(la « bande » de 10 amis fictifs), expliqués dans `docs/jeux-de-donnees.md`.

## 1. Ce qu'on teste

La même question a trois réponses dans Freecrew :

| Vue                              | Où                                                    | Code                                             | Trajets ? |
| -------------------------------- | ----------------------------------------------------- | ------------------------------------------------ | --------- |
| **Grille** du groupe             | Groupe → « Quand on peut se voir » → vue grille       | `scheduling/availabilityGrid.ts`                 | Non       |
| **Propositions** du groupe       | Groupe → « Quand on peut se voir »                    | `scheduling/findMeetups.ts`, `meetups/search.ts` | Oui       |
| **« Je suis libre maintenant »** | Accueil (site) et carte « Libre maintenant » (mobile) | `scheduling/freeNow.ts`, `meetups/freeNow.ts`    | Oui       |

Règles à vérifier partout :

1. **Règle d'or** : une proposition ne demande jamais à quelqu'un d'être à deux endroits (cours,
   trajet et marge de 5 min compris).
2. **Jamais dans le passé** : pour « maintenant », personne ne doit être parti avant maintenant.
3. **Vie privée** : on ne voit que les groupes dont on est membre, et l'horaire des autres
   seulement par un groupe en commun (titres masqués s'ils l'ont choisi).
4. **Fuseau** : heures de Montréal (America/Toronto), même aux changements d'heure.
5. **Les réglages de chacun comptent** : heures « je ne sors pas », limite de sorties,
   disponibilités ponctuelles, cours annulés, récurrences.

## 2. Niveaux de test

| Niveau                      | Outil                     | Fichier                                                 | Quand                    |
| --------------------------- | ------------------------- | ------------------------------------------------------- | ------------------------ |
| Logique pure                | Vitest                    | `src/lib/scheduling/__tests__/scenarios-groupe.test.ts` | À chaque changement      |
| Logique + magasin (sans BD) | Vitest, `datasetStore`    | même fichier (S33, S36 à S40)                           | À chaque changement      |
| BD réelle (RLS)             | Vitest + PGlite           | `src/lib/db/__tests__/meetups.test.ts`, `seed.test.ts`  | À chaque changement      |
| Écrans, à la main           | Base Supabase **de test** | ce plan, section 5                                      | Avant une version        |
| Mobile (iOS et Android)     | Expo, même base de test   | ce plan, section 6                                      | Après `npm run sync:web` |

Commandes (dans `FreecrewWeb`) :

```bash
npx vitest run src/lib/scheduling/__tests__/scenarios-groupe.test.ts   # seulement ce plan
npm test && npm run lint && npm run build                              # avant une PR
```

## 3. Les données

Le groupe **« Toute la bande »** (ajouté pour ce plan) réunit les 10 personnes, donc tous les
cas à la fois. Les autres groupes isolent un cas chacun.

| Personne | Ce qu'elle apporte au test                                                |
| -------- | ------------------------------------------------------------------------- |
| ali      | Cours au cégep (Longueuil), transport en commun                           |
| Sam      | Même cégep (même endroit, 0 min de trajet), deux cours qui se chevauchent |
| Maya     | UdeM (loin du cégep) : le trajet mange le temps libre                     |
| Léo      | Travaille à Laval, même la fin de semaine                                 |
| Nora     | Horaire vide : toujours libre                                             |
| Zoé      | **Pas de maison** : écartée du calcul                                     |
| Félix    | Sherbrooke, à pied : jamais en personne, seulement en appel               |
| Jade     | Ne sort pas avant 10 h ni après 20 h, une sortie par jour                 |
| Hugo     | Quart de nuit de part et d'autre de minuit                                |
| Lina     | Une semaine sur deux, cours annulé, disponible pendant son travail        |

## 4. Cas de test automatisés (S29 à S41)

Légende : ✅ réussite · ⚠️ cas limite · ❌ erreur ou aucun résultat attendu.

| Id  | Cas                                                    | Type | Données                                   | Attendu (résumé)                                                      |
| --- | ------------------------------------------------------ | ---- | ----------------------------------------- | --------------------------------------------------------------------- |
| S29 | Grille : qui est libre à chaque demi-heure             | ✅   | Les quatre, lundi                         | 28 tranches ; les quatre libres seulement 11 h 30-12 h et après 20 h  |
| S30 | Grille « tous libres » mais trajets impossibles        | ⚠️   | Les quatre, lundi 11 h 30                 | Aucune rencontre en personne, appels seulement                        |
| S31 | Tout le monde est libre                                | ✅   | Hugo et Nora mer. ; Les quatre dim.       | 28/28 tranches ; rencontres le soir, réalistes                        |
| S32 | Personne n'est libre                                   | ❌   | ali, Sam, Maya lun. 9 h ; Les quatre ven. | Tranches vides ; aucune proposition, même pas un appel                |
| S33 | Une partie du groupe ; participant ou lecteur étranger | ✅❌ | Les quatre                                | Léo absent ; erreurs « ne fait pas partie » et « introuvable »        |
| S34 | Heures calmes et limite de sorties dans la grille      | ⚠️   | Jade et Nora, sam. et dim.                | Jade absente avant 10 h, après 20 h, et tout le dimanche              |
| S35 | Récurrence et disponibilité ponctuelle                 | ✅   | Lina et Nora                              | Lina libre sam. 13 h-16 h seulement ; jeudi 18 h une semaine sur deux |
| S36 | Membre sans maison                                     | ⚠️   | Avec Zoé                                  | Zoé écartée avec la raison ; pas de grille                            |
| S37 | « Maintenant » ne part jamais dans le passé            | ⚠️   | Toute la bande, 4 moments                 | Début ≥ maintenant + trajet + marge (bogue corrigé, voir section 7)   |
| S38 | « Maintenant » dans tous mes groupes                   | ✅   | Toute la bande                            | 8 essayés, Zoé à part, Félix en appel, Jade pas le dimanche           |
| S39 | « Maintenant » : un groupe, et refus                   | ✅❌ | Pauses du cégep, Jade et Nora             | Sam seul ; « Groupe introuvable » ; Zoé doit choisir sa maison        |
| S40 | Grand groupe sur la semaine                            | ⚠️   | Toute la bande                            | Félix bloque l'en-personne ; < 2 s ; sans lui, propositions réalistes |
| S41 | Changement d'heure                                     | ⚠️   | Semaine du 26 octobre                     | Toujours 28 tranches ; Léo occupé 11 h-17 h, heure locale             |

Cas déjà couverts ailleurs, à garder verts : S01 à S05 (deux personnes), S06 (groupe d'une
personne), S17 (durée minimale), S18 (« maintenant » à deux), S19 (plan accepté qui compte comme
occupé), S24 (API de trajets en panne), S28 (classement sur la semaine).

## 5. Essais à la main sur le site (base de test)

Prépare la base de test comme dans `docs/jeux-de-donnees.md`, section « Essayer à la main »
(deuxième projet Supabase, jamais la vraie base). Le seed crée aussi « Toute la bande ».
Comptes : `freecrew.<nom>@example.com`, mot de passe = ton `SEED_PASSWORD`. Les données sont
datées pour **la semaine du prochain lundi** : choisis « La semaine prochaine ».

| #   | Compte | Étapes                                                                                   | Résultat attendu                                                                                      | S          |
| --- | ------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------- |
| M1  | ali    | « Les quatre » → Quand on peut se voir → 30 min → vue grille, lundi                      | 11 h 30-12 h : 4 noms ; 8 h 30 : seulement Léo ; 13 h : seulement Maya                                | S29        |
| M2  | ali    | Même recherche, liste des propositions, lundi                                            | Pas d'en-personne lundi ; appels 11 h 30-12 h et 20 h-22 h                                            | S30        |
| M3  | ali    | « Les quatre », 1 h, dimanche                                                            | Rencontres en personne après 17 h ; trajets des 4 affichés                                            | S31        |
| M4  | ali    | « Les quatre », décoche Léo                                                              | Léo disparaît de la grille et des trajets                                                             | S33        |
| M5  | ali    | « Avec Zoé »                                                                             | Message : Zoé n'a pas choisi sa maison ; pas de grille                                                | S36        |
| M6  | ali    | « Toute la bande », 1 h                                                                  | Zoé écartée ; seulement des appels ; « Pourquoi pas ? » à noter (section 7)                           | S40        |
| M7  | ali    | « Toute la bande », décoche Félix                                                        | Des rencontres en personne apparaissent                                                               | S40        |
| M8  | nora   | « Jade et Nora », grille, samedi puis dimanche                                           | Samedi : Jade absente avant 10 h et après 20 h. Dimanche : Jade absente partout                       | S34        |
| M9  | nora   | « Lina et Nora », grille, samedi                                                         | Lina présente seulement de 13 h à 16 h                                                                | S35        |
| M10 | ali    | Accueil → « Je suis libre maintenant », **un lundi vers 11 h** (semaine seedée)          | Sam en tête (cégep, 0 min) ; Nora ~14 min après le quart d'heure ; Félix en appel ; Zoé nommée à part | S37, S38   |
| M11 | ali    | Même chose, filtre « Pauses du cégep »                                                   | Seulement Sam                                                                                         | S39        |
| M12 | ali    | « Je suis libre maintenant » après 22 h                                                  | Liste vide, message clair                                                                             | S39        |
| M13 | zoe    | « Je suis libre maintenant »                                                             | Demande de choisir une maison                                                                         | S39        |
| M14 | sam    | « Toute la bande » : vérifier qu'aucun titre de cours d'ali n'apparaît si ali les masque | Blocs montrés « Occupé »                                                                              | vie privée |

Note : « Je suis libre maintenant » dépend de l'heure réelle. Pour M10, fais-le pendant la
semaine seedée, à l'heure indiquée ; sinon, compare seulement la forme (ordre, appels, Zoé).

## 6. Essais sur l'app mobile

L'app mobile copie `src/lib` du site (`npm run sync:web` dans `calendrier-mobile`). Après la
fusion de cette PR, resynchronise, puis :

| #   | Où                                    | Étapes                      | Attendu                                                       |
| --- | ------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| A1  | Accueil, carte « Libre maintenant »   | Même moment que M10         | Même liste que le site, même ordre                            |
| A2  | Carte « Libre maintenant »            | Ouvrir la carte (iOS)       | Marqueurs aux bons lieux ; appels sans marqueur               |
| A3  | Groupe « Les quatre »                 | Même recherche que M1 et M2 | Mêmes heures que le site                                      |
| A4  | Thème clair et sombre, iOS et Android | Refaire A1                  | Noms et heures lisibles ; pas de texte coupé avec 9 personnes |
| A5  | Hors ligne                            | Mode avion, ouvrir la carte | Message d'erreur clair, pas de plantage                       |

## 7. Ce que les tests ont trouvé

1. **Bogue corrigé (S37)** : « Je suis libre maintenant » et la recherche « cette semaine »
   faisaient comme si les gens pouvaient être partis **avant maintenant**. Exemple : lundi
   11 h 05, Lina (56 min de trajet) était proposée au cégep dès 11 h 15. La correction
   (`windowsFrom`) fait commencer les fenêtres déjà commencées à « maintenant » avant de
   calculer les trajets. Lina arrive maintenant à 12 h 16. Un ancien test qui attendait le
   mauvais résultat a été corrigé (`freeNow.test.ts`).
2. **À améliorer (S40)** : dans « Toute la bande », Félix bloque toute rencontre en personne,
   et « Pourquoi pas ? » ne propose rien (pas de « sans Félix »), alors que sans lui il y a
   plusieurs rencontres possibles. Probablement parce que son trajet dépasse la journée : aucun
   « presque » n'est trouvé. Pas corrigé ici.
3. **À savoir** : la grille ne tient pas compte des trajets (S30). Elle peut montrer « tous
   libres » alors qu'aucune rencontre en personne n'est possible. C'est voulu, mais l'écran
   pourrait le dire.
