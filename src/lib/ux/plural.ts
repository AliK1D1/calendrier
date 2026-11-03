/**
 * Accord simple en nombre : « 1 groupe », « 2 groupes », « 0 groupe ».
 * En français, 0 et 1 prennent le singulier. Le pluriel par défaut ajoute un « s » ;
 * on peut le donner quand il est irrégulier (« lieu » → « lieux »).
 */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${Math.abs(count) >= 2 ? pluralForm : singular}`;
}
