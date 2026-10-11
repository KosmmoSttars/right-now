# Right Now

The whole Solar System as it stands this second, live at
**https://kosmo-stars.ru/now/**.

- **Planets, the Moon and Pluto** from astronomy-engine (VSOP87, ELP, TOP2013), at
  true size and orientation (IAU 2015 rotation models), the Earth with day and night.
- **Every known asteroid**, about 1.57 million, from the JPL Small-Body Database.
  The GPU solves Kepler's equation for each one every frame, so the belt moves at
  any speed from real time to a year per second. Coloured by population: near-Earth,
  potentially hazardous, Hungarias, main belt, Hildas, Jupiter trojans, centaurs,
  trans-Neptunian objects.
- **Comets** (about 4 000), including near-parabolic and hyperbolic orbits, with tails
  that point away from the Sun.
- **Close approaches** to the Earth within 0.05 au, 30 days back and 90 ahead (CNEOS),
  each flown on its JPL Horizons trajectory, so the pass bends around the Earth exactly
  as computed by JPL.
- **Meteoroids** the Global Meteor Network saw burn up in the last days: every one
  flies along its measured heliocentric orbit to the moment it hit the atmosphere,
  where its luminous path flashes at its real height. Rewind time to watch them fall.
- **Meteor streams** drawn from about 500 real GMN orbits per shower; the streams the
  Earth is crossing today stand out.
- **Fireballs** from US government sensors (CNEOS), the **Sentry** impact-risk list and
  **Scout**'s just-discovered, still-unconfirmed objects.

What no one can show is the meteoroids that have not hit yet: they are too small to see
in space. The streams are a model built from the real orbits of the ones that did.

## How it works

`public/api/data.php` is the whole back end. It caches every dataset on disk, answers
at once from the cache and refreshes it after the response. The asteroid catalogue
is rebuilt every few days from 32 pages of the SBDB query API into six 4 MB chunks
of 16-byte records (log-encoded semi-major axis, eccentricity, angles, mean anomaly
at a common epoch with extra fine bits, class and H), sorted NEOs first and then
largest to smallest, so a partly loaded catalogue already shows the right bodies.
The host kills PHP requests after 100 s, so that build is resumable: each request
does a slice and saves its progress. Run it in full from the command line with
`php public/api/data.php asteroids` (or `live`).

The scene origin floats with the camera focus, so the GPU only ever sees small
numbers near the camera: one scene goes from the Kuiper belt down to a
meteor's path 80 km over a city, with a logarithmic depth buffer.

Drawing a point costs a fixed amount of GPU time (ANGLE emulates point sprites on
Direct3D), so the engine keeps a point budget: while the view moves it draws as many
of the largest asteroids as keep the frame rate up; a still view draws all of them
at a relaxed rate, since nothing visibly moves between frames.

## Develop

```bash
npm install
npm run dev        # http://localhost:3130, the data API is proxied to the live site
npm run build
npm run assets     # planet textures (Solar System Scope, CC BY 4.0) → public/textures
npm run streams    # meteor streams from the GMN 2025 file → public/data/streams.json
```

`node scripts/frames.mjs <url> <prefix> <ms,...>` and `node scripts/perf.mjs` take
screenshots and measure frame rates in headless Edge with the GPU on.

Deploy: `powershell -ExecutionPolicy Bypass -File tools\deploy.ps1`.

## Data and credits

JPL Small-Body Database, CNEOS (close approaches, fireballs, Sentry), JPL Scout,
JPL Horizons, Global Meteor Network (CC BY 4.0), astronomy-engine (MIT),
Yale Bright Star Catalogue, Solar System Scope textures (CC BY 4.0), NASA Blue and
Black Marble.
