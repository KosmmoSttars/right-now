// Downloads the planet textures (Solar System Scope, CC BY 4.0, via Wikimedia Commons)
// into scripts/.cache and writes web-sized WebP copies to public/textures.
// Usage: node scripts/assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const cache = path.join(root, 'scripts/.cache/textures');
const out = path.join(root, 'public/textures');
fs.mkdirSync(cache, { recursive: true });
fs.mkdirSync(out, { recursive: true });

const FILES = [
  ['Solarsystemscope_texture_2k_sun.jpg', 'sun', 1024],
  ['Solarsystemscope_texture_2k_mercury.jpg', 'mercury', 2048],
  ['Solarsystemscope_texture_2k_venus_atmosphere.jpg', 'venus', 1024],
  ['Solarsystemscope_texture_2k_moon.jpg', 'moon', 2048],
  ['Solarsystemscope_texture_2k_mars.jpg', 'mars', 2048],
  ['Solarsystemscope_texture_2k_jupiter.jpg', 'jupiter', 2048],
  ['Solarsystemscope_texture_2k_saturn.jpg', 'saturn', 2048],
  ['Solarsystemscope_texture_2k_saturn_ring_alpha.png', 'saturn-ring', 2048],
  ['Solarsystemscope_texture_2k_uranus.jpg', 'uranus', 1024],
  ['Solarsystemscope_texture_2k_neptune.jpg', 'neptune', 1024],
];

const UA = 'RightNow/1.0 (https://kosmo-stars.ru/now/; asset build script)';

for (const [file, name, width] of FILES) {
  const src = path.join(cache, file);
  if (!fs.existsSync(src)) {
    const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
    fs.writeFileSync(src, Buffer.from(await r.arrayBuffer()));
    console.log('downloaded', file);
  }
  const dst = path.join(out, `${name}.webp`);
  const img = sharp(src).resize({ width, withoutEnlargement: true });
  // The ring strip keeps its alpha; everything else is opaque.
  await (name === 'saturn-ring' ? img.webp({ quality: 90, alphaQuality: 100 }) : img.webp({ quality: 84 })).toFile(dst);
  console.log('wrote', path.relative(root, dst), fs.statSync(dst).size);
}
