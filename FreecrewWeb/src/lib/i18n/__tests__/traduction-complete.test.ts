/**
 * Revue de toute la traduction (2026-11-27) : messages serveur qui restaient en français en
 * anglais (import .ics, calendriers abonnés, Outlook, migrations, véhicules de transport).
 */
import { describe, expect, it } from "vitest";

import { getMessages } from "../messages";
import { translateServerText } from "../serverText";

const en = (s: string) => translateServerText(s, "en");

describe("traduction complète des messages serveur", () => {
  it("traduit les notes de l'import .ics avec le bon nombre", () => {
    expect(en("1 événement annulé ignoré.")).toBe("1 cancelled event ignored.");
    expect(en("3 événements annulés ignorés.")).toBe("3 cancelled events ignored.");
    expect(en("2 événements d'une journée entière ignorés (congés, rappels…).")).toBe(
      "2 all-day events ignored (holidays, reminders…).",
    );
    expect(
      en(
        "1 événement avec une règle de répétition non prise en charge ignoré : ajoute-le à la main.",
      ),
    ).toBe("1 event with an unsupported repeat rule ignored: add it by hand.");
    expect(en("2 titres raccourcis à 100 caractères.")).toBe(
      "2 titles shortened to 100 characters.",
    );
  });

  it("traduit l'ajout d'un calendrier abonné, phrase composée comprise", () => {
    expect(
      en(
        "Calendrier ajouté : 3 événements dans les 8 prochaines semaines. Ils comptent comme du temps occupé.",
      ),
    ).toBe("Calendar added: 3 events in the next 8 weeks. They count as busy time.");
    expect(
      en(
        "Calendrier ajouté (rien de prévu dans les 8 prochaines semaines pour l'instant). Ils sont affichés sans bloquer ton temps libre.",
      ),
    ).toBe(
      "Calendar added (nothing planned in the next 8 weeks for now). They're shown without blocking your free time.",
    );
  });

  it("traduit le message de migration manquante, quel que soit son numéro", () => {
    expect(
      en(
        "La base de données n'est pas à jour : applique supabase/migration-0021.sql (voir README).",
      ),
    ).toBe("The database is out of date: apply supabase/migration-0021.sql (see README).");
  });

  it("traduit les erreurs Outlook et des liens de calendrier", () => {
    expect(en("Outlook n'est plus connecté. Reconnecte Outlook.")).toBe(
      "Outlook is no longer connected. Reconnect Outlook.",
    );
    expect(en("Ce calendrier est privé : le site refuse l'accès.")).toBe(
      "This calendar is private: the site refuses access.",
    );
  });

  it("traduit les véhicules de transport en commun", () => {
    expect(en("Métro")).toBe("Subway");
    expect(en("Train léger")).toBe("Light rail");
    expect(en("Transport en commun")).toBe("Transit");
  });
});

describe("page Profil", () => {
  it("a ses textes dans les deux langues", () => {
    expect(getMessages("fr").profile.sections.quiet).toBe("Heures où je ne sors pas");
    expect(getMessages("en").profile.sections.quiet).toBe("Hours I don't go out");
    expect(getMessages("en").profile.outlook.returns.connecte).toBe(
      "Outlook connected and synced.",
    );
  });
});
