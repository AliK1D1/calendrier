/**
 * Coupe un message de confirmation d'une seule chaîne (« Supprimer « X » ? Il sera retiré… »)
 * en question (titre de la fenêtre) et explication (texte). La coupure se fait au premier
 * point d'interrogation qui n'est pas dans un nom entre guillemets (« … » ou “…”), pour qu'un
 * plan nommé « On sort ? » ne coupe pas la question en deux.
 */
export function splitQuestion(message: string): { title: string; body?: string } {
  const text = message.trim();
  let quoted = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "«" || ch === "“") quoted++;
    else if ((ch === "»" || ch === "”") && quoted > 0) quoted--;
    else if (ch === "?" && quoted === 0) {
      const body = text.slice(i + 1).trim();
      return body ? { title: text.slice(0, i + 1).trim(), body } : { title: text };
    }
  }
  return { title: text };
}
