// Génère public/og-image.png (1200 × 630) : l'aperçu montré quand on partage le lien du site
// (LinkedIn, Messenger, Google). Reprend l'icône de public/icon.svg sur le bleu de l'app.
// Usage : node scripts/generate-og-image.mjs (le fichier produit est commité ; à relancer
// seulement si le dessin ou le texte change). Utilise sharp, déjà installé avec Next.js.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");

const icone = readFileSync(join(PUBLIC, "icon.svg"), "utf8")
  .replace(/<\?xml[^>]*>/, "")
  .replace(/ width="512" height="512"/, "")
  .replace(/<svg /, '<svg x="96" y="155" width="320" height="320" ');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#1f467f"/>
  <circle cx="1080" cy="80" r="260" fill="#2c5fa9" opacity="0.55"/>
  <circle cx="1180" cy="600" r="200" fill="#2c5fa9" opacity="0.35"/>
  ${icone}
  <g font-family="DejaVu Sans, Arial, Helvetica, sans-serif" fill="#ffffff">
    <text x="470" y="290" font-size="104" font-weight="800" letter-spacing="-3">Freecrew</text>
    <text x="474" y="362" font-size="36" fill="#dbe6f7">Trouve du temps libre en commun</text>
    <text x="474" y="410" font-size="36" fill="#dbe6f7">avec tes amis, trajets compris.</text>
  </g>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(join(PUBLIC, "og-image.png"));
console.log("public/og-image.png écrit");
