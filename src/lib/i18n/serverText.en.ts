/**
 * Catalogue français → anglais des messages serveur (voir `serverText.ts`).
 * `EN_TEXTS` : messages fixes. `EN_PATTERNS` : messages avec des valeurs (nom, nombre…).
 * Un message composé (« Préfixe : message ») est traduit morceau par morceau.
 */
export const EN_TEXTS: Record<string, string> = {
  "Action non permise.": "Action not allowed.",
  "Ajoute d'abord un examen ou un travail à venir.": "First add an upcoming exam or assignment.",
  "Aucun autre calendrier dans ton compte Outlook.": "No other calendar in your Outlook account.",
  "Aucun de ces jours ne tombe avant la date de fin.":
    "None of these days falls before the end date.",
  "Aucun de ces jours ne tombe dans la session.": "None of these days falls within the term.",
  "Aucun événement trouvé dans ce fichier.": "No event found in this file.",
  "Aucune séance en conflit.": "No session in conflict.",
  "Aucune séance.": "No session.",
  "Bloc introuvable.": "Block not found.",
  "Bloc invalide.": "Invalid block.",
  "Calendrier actualisé.": "Calendar refreshed.",
  "Calendrier introuvable dans ton compte Outlook.": "Calendar not found in your Outlook account.",
  "Calendrier invalide.": "Invalid calendar.",
  "Calendrier retiré : ses événements ne sont plus utilisés.":
    "Calendar removed: its events are no longer used.",
  "Ce fichier .ics est illisible (contenu inattendu).":
    "This .ics file can't be read (unexpected content).",
  "Ce fichier .ics est illisible (format invalide).":
    "This .ics file can't be read (invalid format).",
  "Ce fichier n'est pas un calendrier .ics.": "This file is not an .ics calendar.",
  "Ce lien est trop long.": "This link is too long.",
  "Ce lien ne fonctionne plus (calendrier introuvable).":
    "This link no longer works (calendar not found).",
  "Ce lien pointe vers une adresse interne.": "This link points to an internal address.",
  "Ce moment est déjà commencé ou passé.": "This time has already started or passed.",
  "Cette date est déjà passée.": "This date has already passed.",
  "Cette séance est déjà commencée ou passée.": "This session has already started or passed.",
  "Choisis au moins deux participants.": "Choose at least two participants.",
  "Choisis au moins un bloc à importer.": "Choose at least one block to import.",
  "Choisis au moins une personne à inviter.": "Choose at least one person to invite.",
  "Choisis d'abord ton lieu « maison » (page Mes lieux) pour que le calcul marche.":
    "First choose your “home” place (My places page) so the search can work.",
  "Choisis examen ou travail.": "Choose exam or assignment.",
  "Choisis l'adresse de ta maison.": "Choose your home address.",
  "Choisis l'heure.": "Choose the time.",
  "Choisis l'unité : jours, semaines, mois ou ans.":
    "Choose the unit: days, weeks, months or years.",
  "Choisis la date de début.": "Choose the start date.",
  "Choisis la date de fin.": "Choose the end date.",
  "Choisis la date.": "Choose the date.",
  "Choisis le jour du bloc.": "Choose the block's day.",
  "Choisis les participants.": "Choose the participants.",
  "Choisis quand la répétition s'arrête.": "Choose when the repetition stops.",
  "Choisis si ce calendrier compte comme du temps occupé.":
    "Choose whether this calendar counts as busy time.",
  "Choisis ta maison dans « Mes lieux » avant de planifier ton étude.":
    "Choose your home in “My places” before planning your study.",
  "Choisis un calendrier.": "Choose a calendar.",
  "Choisis un fichier .ics.": "Choose an .ics file.",
  "Choisis un jour.": "Choose a day.",
  "Choisis une date dans l'année qui vient.": "Choose a date within the coming year.",
  "Coche au moins un jour de la semaine.": "Check at least one day of the week.",
  "Code d'invitation invalide.": "Invalid invite code.",
  "Colle le lien du calendrier.": "Paste the calendar link.",
  "Connecte d'abord Outlook (plus haut).": "First connect Outlook (above).",
  "Connexion requise.": "Sign-in required.",
  "Connexion à Outlook annulée.": "Outlook connection cancelled.",
  "Crée un groupe et partage le lien d'invitation.": "Create a group and share the invite link.",
  "Date de fin invalide.": "Invalid end date.",
  "Date invalide.": "Invalid date.",
  "Demande invalide.": "Invalid request.",
  "Difficulté invalide.": "Invalid difficulty.",
  "Disponibilité ajoutée.": "Availability added.",
  "Disponibilité introuvable.": "Availability not found.",
  "Disponibilité supprimée.": "Availability deleted.",
  "Donne un titre au bloc (ex. « Chimie »).": "Give the block a title (e.g. “Chemistry”).",
  "Données invalides.": "Invalid data.",
  "Durée de séance invalide.": "Invalid session length.",
  "Durée invalide (entre 15 min et 2 h, par tranches de 5 min).":
    "Invalid length (between 15 min and 2 h, in 5-minute steps).",
  "Déjà à jour : réessaie dans quelques minutes.":
    "Already up to date: try again in a few minutes.",
  "Déjà à jour : réessaie dans une minute.": "Already up to date: try again in a minute.",
  "Formulaire invalide.": "Invalid form.",
  "Groupe introuvable.": "Group not found.",
  "Heure de début invalide.": "Invalid start time.",
  "Heure invalide.": "Invalid time.",
  "Heure limite de la veille invalide.": "Invalid evening-before cutoff time.",
  "Heures d'étude invalides.": "Invalid study hours.",
  "Heures enregistrées.": "Hours saved.",
  "Import invalide.": "Invalid import.",
  "Impossible de lire les plans. Réessaie.": "Couldn't read the plans. Try again.",
  "Indique le début et la fin de la session.": "Enter the start and end of the term.",
  "Jour de la semaine invalide.": "Invalid day of the week.",
  "Jour invalide.": "Invalid day.",
  "L'enregistrement n'a pas fonctionné. Réessaie.": "Saving didn't work. Try again.",
  "L'heure de fin doit être après l'heure de début.": "The end time must be after the start time.",
  "La base de données n'est pas configurée.": "The database is not configured.",
  "La base de données n'est pas à jour : applique les fichiers supabase/migration-000N.sql manquants (voir README).":
    "The database is not up to date: apply the missing supabase/migration-000N.sql files (see README).",
  "La base de données n'est pas à jour : applique supabase/migration-0018.sql (et les précédentes, voir README).":
    "The database is not up to date: apply supabase/migration-0018.sql (and the earlier ones, see README).",
  "La connexion à Outlook a expiré. Recommence.": "The Outlook connection expired. Start again.",
  "La connexion à Outlook n'a pas fonctionné. Réessaie.":
    "Connecting to Outlook didn't work. Try again.",
  "La date de fin doit être après la date de début.": "The end date must be after the start date.",
  "La durée maximale doit être au moins la durée minimale.":
    "The maximum length must be at least the minimum length.",
  "La déconnexion n'a pas fonctionné. Réessaie.": "Disconnecting didn't work. Try again.",
  "La fin de la session doit être après son début.": "The end of the term must be after its start.",
  "La fin doit être après la première fois.": "The end must be after the first time.",
  "La fin doit être après le début.": "The end must be after the start.",
  "La fin doit être dans moins de 10 ans.": "The end must be less than 10 years away.",
  "La note contient des caractères non permis.":
    "The note contains characters that aren't allowed.",
  "La proposition n'a pas fonctionné.": "The proposal didn't work.",
  "La recherche contient des caractères invalides.": "The search contains invalid characters.",
  "La répétition dure plus de 10 ans : choisis « Jamais » ou une fin plus proche.":
    "The repetition lasts more than 10 years: choose “Never” or a closer end.",
  "La répétition va de 1 à 99.": "The repetition goes from 1 to 99.",
  "La session dure plus d'un an : vérifie les dates.":
    "The term lasts more than a year: check the dates.",
  "La vérification n'a pas fonctionné. Réessaie.": "The check didn't work. Try again.",
  "Le calcul n'a pas fonctionné. Réessaie.": "The calculation didn't work. Try again.",
  "Le cours est manquant.": "The course is missing.",
  "Le fichier est trop gros (1 Mo au maximum).": "The file is too big (1 MB maximum).",
  "Le fichier est vide.": "The file is empty.",
  "Le jour doit être entre aujourd'hui et dans un an.":
    "The day must be between today and a year from now.",
  "Le maximum par jour doit permettre au moins une séance.":
    "The daily maximum must allow at least one session.",
  "Le nom du cours contient des caractères invalides.":
    "The course name contains invalid characters.",
  "Le nom du groupe contient des caractères invalides.":
    "The group name contains invalid characters.",
  "Le nom du groupe est manquant.": "The group name is missing.",
  "Le nom du groupe ne peut pas être vide.": "The group name can't be empty.",
  "Le retrait n'a pas fonctionné. Réessaie.": "Removing didn't work. Try again.",
  "Le service de recherche d'adresses est occupé. Réessaie dans quelques secondes.":
    "The address search service is busy. Try again in a few seconds.",
  "Le service de recherche d'adresses ne répond pas. Réessaie plus tard.":
    "The address search service isn't responding. Try again later.",
  "Le titre contient des caractères invalides.": "The title contains invalid characters.",
  "Le titre est manquant.": "The title is missing.",
  "Les heures d'étude doivent laisser le temps d'une séance.":
    "Study hours must leave time for one session.",
  "Les heures estimées vont de 0,5 à 60, par demi-heure (ou laisse vide).":
    "Estimated hours go from 0.5 to 60, in half hours (or leave empty).",
  "Les règles de récurrence de ce fichier sont trop longues.":
    "This file's recurrence rules are too long.",
  "Les séances commencent et finissent au quart d'heure.":
    "Sessions start and end on the quarter hour.",
  "Lien brisé.": "Broken link.",
  "Lieu introuvable.": "Place not found.",
  "Lieu invalide.": "Invalid place.",
  "Liste de personnes invalide.": "Invalid list of people.",
  "Maximum par jour invalide.": "Invalid daily maximum.",
  "Microsoft n'a pas donné l'accès hors ligne. Réessaie.":
    "Microsoft didn't grant offline access. Try again.",
  "Mode de transport invalide.": "Invalid travel mode.",
  "Note invalide.": "Invalid note.",
  "Outlook connecté et synchronisé.": "Outlook connected and synced.",
  "Outlook est connecté, mais la première synchro n'a pas fonctionné (voir ci-dessus).":
    "Outlook is connected, but the first sync didn't work (see above).",
  "Outlook n'est pas connecté.": "Outlook is not connected.",
  "Outlook n'est pas encore configuré sur ce site.": "Outlook is not set up on this site yet.",
  "Part gardée libre invalide.": "Invalid share kept free.",
  "Participant introuvable.": "Participant not found.",
  "Pause invalide.": "Invalid break.",
  "Position du lieu hors limites.": "Place position out of range.",
  "Position du lieu invalide.": "Invalid place position.",
  "Pour partir, utilise « Quitter le groupe ».": "To leave, use “Leave the group”.",
  "Profil enregistré.": "Profile saved.",
  "Profil introuvable.": "Profile not found.",
  "Propose un moment dans la prochaine année.": "Propose a time within the next year.",
  "Proposition invalide.": "Invalid proposal.",
  "Préférences enregistrées.": "Preferences saved.",
  "Période invalide.": "Invalid period.",
  "Retire le nom d'utilisateur et le mot de passe du lien.":
    "Remove the username and password from the link.",
  "Réglage enregistré.": "Setting saved.",
  "Réglage invalide.": "Invalid setting.",
  "Réponse invalide.": "Invalid answer.",
  "Répétition invalide.": "Invalid repetition.",
  "Seul l'auteur du lieu ou un admin peut le supprimer.":
    "Only the place's author or an admin can delete it.",
  "Seul un admin du groupe peut retirer un membre.": "Only a group admin can remove a member.",
  "Séance en double.": "Duplicate session.",
  "Séance introuvable.": "Session not found.",
  "Séance invalide.": "Invalid session.",
  "Séance à remplacer introuvable.": "Session to replace not found.",
  "Ta session a expiré. Reconnecte-toi.": "Your session expired. Sign in again.",
  "Tape une adresse ou un nom de lieu.": "Type an address or a place name.",
  "Ton horaire est plein (1000 blocs au maximum) : supprime des blocs dans Mon horaire, puis réessaie.":
    "Your schedule is full (1000 blocks maximum): delete blocks in My schedule, then try again.",
  "Tout est déjà planifié : rien de plus à proposer.":
    "Everything is already planned: nothing more to suggest.",
  "Trop d'aperçus d'un coup. Attends une minute et réessaie.":
    "Too many previews at once. Wait a minute and try again.",
  "Trop d'essais avec Outlook d'un coup. Attends une minute et réessaie.":
    "Too many Outlook attempts at once. Wait a minute and try again.",
  "Trop de calculs d'un coup. Attends une minute.": "Too many calculations at once. Wait a minute.",
  "Trop de recherches d'un coup. Attends une minute et réessaie.":
    "Too many searches at once. Wait a minute and try again.",
  "Tu ne fais pas partie de ce groupe.": "You're not part of this group.",
  "Type de bloc invalide.": "Invalid block type.",
  "Un bloc modifié a un seul jour de la semaine.": "An edited block has a single day of the week.",
  "Un des participants ne fait pas partie du groupe.":
    "One of the participants isn't part of the group.",
  "Un plan dure de 15 minutes à 12 heures.": "A plan lasts from 15 minutes to 12 hours.",
  "Un plan finit le même jour (au plus tard à minuit).":
    "A plan ends the same day (at midnight at the latest).",
  "Valeur refusée par la base de données.": "Value refused by the database.",
  "Échéance introuvable.": "Deadline not found.",
  "Écris le nom du cours.": "Write the course name.",
  "Propositions retirées. Rien n'a été ajouté à ton horaire.":
    "Suggestions removed. Nothing was added to your schedule.",
};

/** « 2 séances » → « 2 sessions » (le nombre vient du texte français). */
const count = (n: string, one: string, many: string) => `${n} ${Number(n) === 1 ? one : many}`;

/** « l'examen de chimie », « le travail d'anglais » → « the chemistry exam »… */
function deadlineEn(fr: string): string {
  const m = /^(l'examen|le travail) (?:de |d')(.+)$/i.exec(fr);
  if (!m) return fr;
  return `the ${m[1].toLowerCase() === "l'examen" ? "exam" : "assignment"} for ${m[2]}`;
}

/** « 1 h 30 » (français) → « 1 h 30 min ». */
const durationEn = (d: string) => d.replace(/^(\d+) h (\d+)$/, "$1 h $2 min");

export const EN_PATTERNS: [RegExp, (...groups: string[]) => string][] = [
  [/^Au plus (\d+) participants\.$/, (n) => `At most ${n} participants.`],
  [/^Au plus (\d+) séances à la fois\.$/, (n) => `At most ${n} sessions at a time.`],
  [
    /^Ce calendrier a trop d'événements \(au plus (\d+) sur 8 semaines\)\.$/,
    (n) => `This calendar has too many events (at most ${n} over 8 weeks).`,
  ],
  [
    /^Ce fichier donnerait (\d+) blocs \(au plus (\d+)\)\. Exporte seulement l'horaire de la session\.$/,
    (a, b) => `This file would give ${a} blocks (at most ${b}). Export only the term's schedule.`,
  ],
  [/^Choisis un lieu pour « (.+) »\.$/, (x) => `Choose a place for “${x}”.`],
  [
    /^Indique un nombre de fois entier de 1 à (\d+)\.$/,
    (n) => `Enter a whole number of times from 1 to ${n}.`,
  ],
  [
    /^Indique un nombre entier de 1 à (\d+) pour « tous les … »\.$/,
    (n) => `Enter a whole number from 1 to ${n} for “every …”.`,
  ],
  [
    /^L'heure de fin doit être au moins (\d+) min après le début\.$/,
    (n) => `The end time must be at least ${n} min after the start.`,
  ],
  [
    /^La marge doit être entre 0 et (\d+) min\.$/,
    (n) => `The margin must be between 0 and ${n} min.`,
  ],
  [/^La note fait au plus (\d+) caractères\.$/, (n) => `The note is at most ${n} characters.`],
  [
    /^Le fichier contient trop d'occurrences d'ici un an \(plus de (\d+)\)\.$/,
    (n) => `The file has too many occurrences within a year (more than ${n}).`,
  ],
  [
    /^Le fichier contient trop d'événements \((\d+), au plus (\d+)\)\. Exporte seulement l'horaire de la session\.$/,
    (a, b) => `The file has too many events (${a}, at most ${b}). Export only the term's schedule.`,
  ],
  [
    /^Le nom du cours est trop long \((\d+) caractères au maximum\)\.$/,
    (n) => `The course name is too long (${n} characters maximum).`,
  ],
  [
    /^Le nom du groupe est trop long \((\d+) caractères au maximum\)\.$/,
    (n) => `The group name is too long (${n} characters maximum).`,
  ],
  [
    /^Le titre est trop long \((\d+) caractères au maximum\)\.$/,
    (n) => `The title is too long (${n} characters maximum).`,
  ],
  [
    /^Recherche trop longue \((\d+) caractères au maximum\)\.$/,
    (n) => `Search too long (${n} characters maximum).`,
  ],
  [/^Tape au moins (\d+) caractères\.$/, (n) => `Type at least ${n} characters.`],
  [/^Trop de blocs \(au plus (\d+)\)\.$/, (n) => `Too many blocks (at most ${n}).`],
  [/^Trop de nouveaux lieux \(au plus (\d+)\)\.$/, (n) => `Too many new places (at most ${n}).`],
  [
    /^Calendrier ajouté : (\d+) événements? dans les 8 prochaines semaines\.$/,
    (n) => `Calendar added: ${count(n, "event", "events")} in the next 8 weeks.`,
  ],
  [
    /^Outlook synchronisé \((\d+) blocs, les plus proches seulement : il y en avait trop\)\.$/,
    (n) => `Outlook synced (${n} blocks, the nearest only: there were too many).`,
  ],
  [
    /^Il te manque (.+) avant (.+)\.$/,
    (d, x) => `You're missing ${durationEn(d)} before ${deadlineEn(x)}.`,
  ],
  [
    /^Pas de moment libre pour replacer une séance avant (.+)\.$/,
    (x) => `No free time to move a session before ${deadlineEn(x)}.`,
  ],
  [/^Cette séance finit après (.+)\.$/, (x) => `This session ends after ${deadlineEn(x)}.`],
  [
    /^(.+) est déjà passé : rien de proposé\.$/,
    (x) =>
      `${capitalizeEn(deadlineEn(x.charAt(0).toLowerCase() + x.slice(1)))} has already passed: nothing suggested.`,
  ],
  [
    /^(.+) est aujourd'hui : seulement une courte révision\.$/,
    (x) =>
      `${capitalizeEn(deadlineEn(x.charAt(0).toLowerCase() + x.slice(1)))} is today: only a short review.`,
  ],
  [
    /^(.+) est aujourd'hui : pas de moment libre pour une courte révision\.$/,
    (x) =>
      `${capitalizeEn(deadlineEn(x.charAt(0).toLowerCase() + x.slice(1)))} is today: no free time for a short review.`,
  ],
  [
    /^Une séance dure de (.+) à (.+)\.$/,
    (a, b) => `A session lasts from ${durationEn(a)} to ${durationEn(b)}.`,
  ],
  [
    /^(\d+) autres? séances? en conflit : accepte ces propositions, puis replanifie de nouveau\.$/,
    (n) =>
      `${count(n, "other session", "other sessions")} in conflict: accept these suggestions, then replan again.`,
  ],
  [/^(\d+) séances? refusées?\.$/, (n) => `${count(n, "session", "sessions")} declined.`],
  [
    /^(\d+) séances? ajoutées? à ton horaire\.$/,
    (n) => `${count(n, "session", "sessions")} added to your schedule.`,
  ],
  [
    /^(\d+) séances? déplacées? dans ton horaire\.$/,
    (n) => `${count(n, "session", "sessions")} moved in your schedule.`,
  ],
  [/^Séance déplacée : (.+)\.$/, (x) => `Session moved: ${x}.`],
  [
    /^(.+) On garde la dernière version connue\.$/,
    (x) => `${translateInner(x)} Keeping the last known version.`,
  ],
  [/^(.+) contient des caractères invalides\.$/, (l) => `${l} contains invalid characters.`],
  [
    /^(.+) est trop long \((\d+) caractères au maximum\)\.$/,
    (l, n) => `${l} is too long (${n} characters maximum).`,
  ],
  [/^(.+) ne peut pas être vide\.$/, (l) => `${l} can't be empty.`],
  // Messages composés « Préfixe : message » : le message est traduit à part.
  [/^Séance non déplacée : ([\s\S]+)$/, (x) => `Session not moved: ${translateInner(x)}`],
  [/^Cégep ou école : ([\s\S]+)$/, (x) => `College or school: ${translateInner(x)}`],
  [/^Nouveau lieu : ([\s\S]+)$/, (x) => `New place: ${translateInner(x)}`],
  [/^([^:]+, [^:]+) : ([\s\S]+)$/, (label, x) => `${label}: ${translateInner(x)}`],
];

function capitalizeEn(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Traduit un morceau de message (exact ou motif), sinon le laisse tel quel. */
function translateInner(text: string): string {
  const exact = EN_TEXTS[text];
  if (exact !== undefined) return exact;
  for (const [re, to] of EN_PATTERNS) {
    const m = re.exec(text);
    if (m) return to(...m.slice(1));
  }
  return text;
}
