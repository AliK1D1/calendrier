// Génère les icônes de l'app (favicon et PWA) dans public/ et src/app/favicon.ico.
// Dessin original : un calendrier dans lequel deux cercles se chevauchent (le temps libre
// de deux amis) ; leur intersection, le moment commun, est remplie. Blanc sur le bleu de
// l'app (--primary). Usage : node scripts/generate-icons.mjs (les fichiers produits sont
// commités ; à relancer seulement si le dessin ou la couleur change). Utilise sharp, déjà
// installé avec Next.js.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");

/** Bleu de l'app : oklch(0.49 0.13 258) (--primary, mode clair). */
export const ICON_BLUE = "#2c5fa9";

/** Dessin sur une grille de 512, centré, sans fond. */
const GLYPH = `
    <defs>
      <clipPath id="a"><circle cx="218" cy="306" r="62"/></clipPath>
    </defs>
    <g fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round">
      <rect x="104" y="124" width="304" height="284" rx="44" stroke-width="28"/>
      <path d="M104 200h304" stroke-width="28"/>
      <path d="M190 92v64M322 92v64" stroke-width="28"/>
    </g>
    <circle cx="294" cy="306" r="62" clip-path="url(#a)" fill="#ffffff"/>
    <g fill="none" stroke="#ffffff" stroke-width="18">
      <circle cx="218" cy="306" r="62"/>
      <circle cx="294" cy="306" r="62"/>
    </g>`;

/**
 * Icône carrée de 512 × 512. `maskable` : fond plein jusqu'aux bords (le téléphone découpe
 * sa propre forme) et dessin réduit dans la zone sûre (cercle de 80 %) ; sinon coins arrondis.
 */
function iconSvg({ maskable }) {
  const background = maskable
    ? `<rect width="512" height="512" fill="${ICON_BLUE}"/>`
    : `<rect width="512" height="512" rx="112" fill="${ICON_BLUE}"/>`;
  const transform = maskable
    ? ` transform="translate(256 256) scale(0.78) translate(-256 -256)"`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  ${background}
  <g${transform}>${GLYPH}
  </g>
</svg>
`;
}

/** Fichier .ico contenant des PNG (accepté par tous les navigateurs actuels). */
async function ico(svg, sizes, file) {
  const pngs = await Promise.all(
    sizes.map((size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()),
  );
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((data, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(sizes[i] % 256, entry);
    header.writeUInt8(sizes[i] % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  writeFileSync(file, Buffer.concat([header, ...pngs]));
  console.log(`Écrit : ${file}`);
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
await ico(rounded, [16, 32, 48], join(ROOT, "src", "app", "favicon.ico"));
