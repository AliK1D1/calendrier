// Génère les icônes de l'app installable (PWA) dans public/ : un calendrier avec un cœur
// (icône CalendarHeart de Lucide, licence ISC) en blanc sur le bleu de l'app (--primary).
// Usage : node scripts/generate-icons.mjs (les fichiers produits sont commités ; à relancer
// seulement si le dessin ou la couleur change). Utilise sharp, déjà installé avec Next.js.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");

/** Bleu de l'app : oklch(0.49 0.13 258) (--primary, mode clair). */
export const ICON_BLUE = "#2c5fa9";

const GLYPH = `
    <path d="M12.127 21H5a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v5.125"/>
    <path d="M14.62 17.8A2.25 2.25 0 1118 14.836a2.25 2.25 0 113.38 2.966l-2.626 2.856a.998.998 0 01-1.507 0z"/>
    <path d="M16 2v3"/>
    <path d="M3 9h18"/>
    <path d="M8 2v3"/>`;

/**
 * Icône carrée de 512 × 512. `maskable` : fond plein jusqu'aux bords (le téléphone découpe
 * sa propre forme) et dessin dans la zone sûre (cercle de 80 %) ; sinon coins arrondis.
 */
function iconSvg({ maskable }) {
  const glyphSize = maskable ? 240 : 300;
  const offset = (512 - glyphSize) / 2;
  const scale = glyphSize / 24;
  const background = maskable
    ? `<rect width="512" height="512" fill="${ICON_BLUE}"/>`
    : `<rect width="512" height="512" rx="112" fill="${ICON_BLUE}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  ${background}
  <g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPH}
  </g>
</svg>
`;
}

async function png(svg, size, file) {
  await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(file);
  console.log(`Écrit : ${file}`);
}

const rounded = iconSvg({ maskable: false });
const maskable = iconSvg({ maskable: true });

writeFileSync(join(PUBLIC, "icon.svg"), rounded);
console.log(`Écrit : ${join(PUBLIC, "icon.svg")}`);
await png(rounded, 192, join(PUBLIC, "icon-192.png"));
await png(rounded, 512, join(PUBLIC, "icon-512.png"));
await png(maskable, 512, join(PUBLIC, "icon-maskable-512.png"));
// iOS arrondit lui-même les coins de l'icône de l'écran d'accueil : fond plein.
await png(maskable, 180, join(PUBLIC, "apple-touch-icon.png"));
