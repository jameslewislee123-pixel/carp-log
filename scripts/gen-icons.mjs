// Generate PWA icons + iOS splash screens.
// Gold (#D4B673) carp silhouette on #0A1816 dark teal.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const BG = '#0A1816';
const FG = '#D4B673';

// Stylized carp silhouette as SVG path (body + tail + dorsal + eye).
const carpPath = (color = FG) => `
  <g fill="${color}">
    <path d="M120 320
             C 200 220, 360 220, 480 280
             C 540 200, 600 200, 660 240
             C 620 280, 620 360, 660 400
             C 600 440, 540 440, 480 360
             C 360 420, 200 420, 120 320 Z"/>
    <circle cx="450" cy="290" r="14" fill="${BG}"/>
    <path d="M170 320 C 230 280, 230 360, 170 320 Z" fill="${BG}" opacity="0.18"/>
  </g>`;

const iconSvg = (size = 1024) => {
  const carp = carpPath();
  // viewBox is 800 wide; scale into "size"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 800 640">
    <rect width="800" height="640" fill="${BG}"/>
    ${carp}
  </svg>`;
};

const splashSvg = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <radialGradient id="g" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#0F211E"/>
      <stop offset="100%" stop-color="#050E0D"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <g transform="translate(${(w - 360) / 2}, ${(h - 280) / 2}) scale(0.45)">
    ${carpPath()}
  </g>
  <text x="50%" y="${h / 2 + 200}" text-anchor="middle"
        font-family="Georgia, serif" font-size="46" fill="${FG}" font-weight="500" letter-spacing="2">Carp Log</text>
</svg>`;

async function gen(svg, out, size) {
  await mkdir(dirname(out), { recursive: true });
  let pipeline = sharp(Buffer.from(svg));
  if (size) pipeline = pipeline.resize(size, size);
  await pipeline.png().toFile(out);
  console.log('  ✓', out);
}

async function genSplash(out, w, h) {
  await mkdir(dirname(out), { recursive: true });
  await sharp(Buffer.from(splashSvg(w, h))).png().toFile(out);
  console.log('  ✓', out);
}

console.log('Generating icons…');
await gen(iconSvg(), 'public/icons/icon-512.png', 512);
await gen(iconSvg(), 'public/icons/icon-192.png', 192);
await gen(iconSvg(), 'public/icons/apple-touch-icon.png', 180);
await gen(iconSvg(), 'public/icons/favicon.png', 64);

console.log('Generating splash screens…');
await genSplash('public/splash/iphone13.png',     1170, 2532);
await genSplash('public/splash/iphone13promax.png', 1284, 2778);
await genSplash('public/splash/iphonex.png',      1125, 2436);
console.log('Done.');
