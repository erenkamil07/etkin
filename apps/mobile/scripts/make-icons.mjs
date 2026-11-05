// Draws Etkin's mark (a ticket with an "E" cut into it) and renders every icon
// the app needs: the app icon, Android's adaptive layers and themed
// monochrome icon, the splash image, the web favicon and home-screen icons,
// and the Play Store icon.
// Pure geometry, no font files, so the output is the same on every machine.
//
// The renderer is not an app dependency. Install it anywhere and point at it:
//   npm install --prefix /tmp/resvg @resvg/resvg-js@2.6.2
//   RESVG=/tmp/resvg/node_modules/@resvg/resvg-js node apps/mobile/scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Resvg } = require(process.env.RESVG ?? '@resvg/resvg-js');

const ORANGE = '#FF5A1F';
const ORANGE_LIGHT = '#FF7A45';
const ORANGE_DEEP = '#E8480F';
const INK = '#0F0F12';

/**
 * The ticket, centred on a 1024 canvas: a rounded card with a notch on each
 * side, a dashed tear line towards the right and a geometric "E", all cut out
 * so whatever is behind shows through.
 */
function mark({ fill, scale = 1, id }) {
  const e = [
    // The "E": a spine and three arms, slightly rounded.
    { x: -190, y: -130, w: 62, h: 260 },
    { x: -190, y: -130, w: 230, h: 60 },
    { x: -190, y: -30, w: 200, h: 60 },
    { x: -190, y: 70, w: 230, h: 60 },
  ]
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="14" fill="black"/>`)
    .join('');
  return `
  <defs>
    <mask id="${id}" maskUnits="userSpaceOnUse" x="-512" y="-512" width="1024" height="1024">
      <rect x="-260" y="-180" width="520" height="360" rx="56" fill="white"/>
      <circle cx="-260" cy="0" r="58" fill="black"/>
      <circle cx="260" cy="0" r="58" fill="black"/>
      <line x1="140" y1="-138" x2="140" y2="138" stroke="black" stroke-width="16" stroke-linecap="round" stroke-dasharray="22 26"/>
      ${e}
    </mask>
  </defs>
  <g transform="translate(512 512) rotate(-12) scale(${scale})">
    <rect x="-300" y="-220" width="600" height="440" fill="${fill}" mask="url(#${id})"/>
  </g>`;
}

const orangeBackground = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${ORANGE_LIGHT}"/>
      <stop offset="0.55" stop-color="${ORANGE}"/>
      <stop offset="1" stop-color="${ORANGE_DEEP}"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>`;

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${body}</svg>`;

// Android crops adaptive icons to shapes that keep only the middle 66%, so
// the foreground mark is smaller than on the full-bleed icon.
const ADAPTIVE_SCALE = 0.92;

const images = {
  // Full-bleed app icon (iOS and older Android launchers mask it themselves).
  'images/icon.png': { size: 1024, svg: svg(orangeBackground + mark({ fill: INK, scale: 1.05, id: 'm' })) },
  'images/android-icon-background.png': { size: 1024, svg: svg(orangeBackground) },
  'images/android-icon-foreground.png': {
    size: 1024,
    svg: svg(mark({ fill: INK, scale: ADAPTIVE_SCALE, id: 'm' })),
  },
  // Android 13+ themed icons recolour this silhouette to match the wallpaper.
  'images/android-icon-monochrome.png': {
    size: 1024,
    svg: svg(mark({ fill: '#FFFFFF', scale: ADAPTIVE_SCALE, id: 'm' })),
  },
  // Shown on the dark splash background, so the mark is orange there.
  'images/splash-icon.png': { size: 1024, svg: svg(mark({ fill: ORANGE, scale: 1.3, id: 'm' })) },
  'images/favicon.png': {
    size: 64,
    svg: svg(`<rect width="1024" height="1024" rx="230" fill="${ORANGE}"/>${mark({ fill: INK, scale: 1.2, id: 'm' })}`),
  },
  // Google Play's listing icon: 512 x 512, uploaded by hand in Play Console.
  'store/play-store-icon-512.png': {
    size: 512,
    svg: svg(orangeBackground + mark({ fill: INK, scale: 1.05, id: 'm' })),
  },
  // The website's home-screen icons (web manifest and iOS). Full-bleed: phones round the corners.
  '../public/icons/icon-192.png': { size: 192, svg: svg(orangeBackground + mark({ fill: INK, scale: 1.05, id: 'm' })) },
  '../public/icons/icon-512.png': { size: 512, svg: svg(orangeBackground + mark({ fill: INK, scale: 1.05, id: 'm' })) },
  '../public/icons/apple-touch-icon.png': {
    size: 180,
    svg: svg(orangeBackground + mark({ fill: INK, scale: 1.05, id: 'm' })),
  },
};

const assets = new URL('../assets/', import.meta.url);
mkdirSync(new URL('store/', assets), { recursive: true });
mkdirSync(new URL('../public/icons/', assets), { recursive: true });
for (const [path, { size, svg: source }] of Object.entries(images)) {
  const png = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(new URL(path, assets), png);
  console.log(`${path}: ${size}px, ${(png.length / 1024).toFixed(1)} KB`);
}

// Google Play's 1024 x 500 feature graphic. Its words are set in the app's own
// font, read from the font package, so this one doesn't depend on system fonts.
const font = (weight) =>
  require.resolve(`@expo-google-fonts/plus-jakarta-sans/${weight}/PlusJakartaSans_${weight}.ttf`);
const feature = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 500">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${ORANGE_LIGHT}"/>
      <stop offset="0.55" stop-color="${ORANGE}"/>
      <stop offset="1" stop-color="${ORANGE_DEEP}"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="500" fill="url(#bg)"/>
  <g transform="translate(250 250) scale(0.62) translate(-512 -512)">${mark({ fill: INK, id: 'f' })}</g>
  <text x="470" y="238" font-family="Plus Jakarta Sans" font-weight="800" font-size="132" fill="${INK}">Etkin</text>
  <text font-family="Plus Jakarta Sans" font-weight="600" font-size="30" fill="${INK}">
    <tspan x="476" y="300">Kulüp etkinliklerine bilet al,</tspan>
    <tspan x="476" y="342">kapıda QR ile gir, puan topla.</tspan>
  </text>
</svg>`;
const featurePng = new Resvg(feature, {
  fitTo: { mode: 'width', value: 1024 },
  font: {
    loadSystemFonts: false,
    fontFiles: [font('800ExtraBold'), font('600SemiBold')],
    defaultFontFamily: 'Plus Jakarta Sans',
  },
})
  .render()
  .asPng();
writeFileSync(new URL('store/play-feature-graphic-1024x500.png', assets), featurePng);
console.log(`store/play-feature-graphic-1024x500.png: ${(featurePng.length / 1024).toFixed(1)} KB`);
