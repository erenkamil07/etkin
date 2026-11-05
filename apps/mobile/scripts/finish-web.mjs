// Runs after `expo export -p web` and turns dist/ into a site people can add
// to their home screen (the way iPhone users get Etkin until it is in the App
// Store): links the web manifest and iOS icon, sets the page language, and
// copies index.html to 404.html so GitHub Pages serves the app for deep links
// such as /etkin/events/<id>.
//
//   EXPO_WEB_BASE_URL=/etkin expo export -p web && node scripts/finish-web.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const base = (process.env.EXPO_WEB_BASE_URL ?? '').replace(/\/$/, '');
const dist = new URL('../dist/', import.meta.url);

const head = [
  `<link rel="manifest" href="${base}/manifest.webmanifest">`,
  `<link rel="apple-touch-icon" href="${base}/icons/apple-touch-icon.png">`,
  '<meta name="description" content="Kulüp etkinliklerine bilet al, kapıda QR ile gir, puan ve rozet kazan.">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="Etkin">',
  // Opaque, so the app never draws under the iPhone status bar.
  '<meta name="apple-mobile-web-app-status-bar-style" content="black">',
].join('\n    ');

let html = readFileSync(new URL('index.html', dist), 'utf8');
if (!html.includes('</head>')) throw new Error('dist/index.html has no </head>; did the export run?');
html = html.replace(/<html lang="[^"]*">/, '<html lang="tr">').replace('</head>', `  ${head}\n  </head>`);
writeFileSync(new URL('index.html', dist), html);
writeFileSync(new URL('404.html', dist), html);
console.log(`dist/ is ready for ${base || '/'}: manifest, iOS icon and 404 fallback added`);
