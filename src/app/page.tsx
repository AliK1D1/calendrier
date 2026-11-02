import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/supabase/server";

const etapes = [
  {
    titre: "Entre ton horaire",
    texte: "Tes cours, ton travail et tes lieux habituels (cégep, maison, job).",
  },
  {
    titre: "Invite tes amis",
    texte: "Crée un groupe et partage le lien d'invitation.",
  },
  {
    titre: "Vois-vous pour vrai",
    texte:
      "L'app propose des moments et des endroits faisables, en tenant compte du temps de trajet de chacun.",
  },
];

// Toujours rendu à la demande : l'affichage dépend de la session.
export const dynamic = "force-dynamic";

export default async function Accueil() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-12 sm:py-20">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Temps libre commun</h1>
        <p className="text-muted-foreground text-lg">
          Des moments et des endroits où se voir qui sont vraiment réalistes : trajet, durée
          minimale et lieu de chacun compris.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Comment ça marche">
        {etapes.map((etape, i) => (
          <Card key={etape.titre}>
            <CardHeader>
              <CardTitle>
                {i + 1}. {etape.titre}
              </CardTitle>
              <CardDescription>{etape.texte}</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        ))}
      </section>

      {user ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            Connecté en tant que <strong>{user.email ?? "utilisateur"}</strong>.
          </p>
          <form action="/auth/deconnexion" method="post">
            <Button type="submit" variant="outline">
              Se déconnecter
            </Button>
          </form>
        </div>
      ) : (
        <div>
          <Button asChild>
            <Link href="/connexion">Se connecter</Link>
          </Button>
        </div>
      )}
    </main>
  );
}
