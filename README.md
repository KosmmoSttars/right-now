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

- **Thirty spacecraft**, from Pioneer 10 and the Voyagers to Europa Clipper and the Mars
  orbiters, each on its JPL Horizons trajectory. An orbiter circles its planet as drawn
  (MRO 280 km over Mars, Juno diving over Jupiter), flybys bend around the planet, and the
  next ones are found in the data and can be replayed. Historic missions (Galileo, Cassini,
  Rosetta, MESSENGER...) appear when you rewind to their years.
- **Sky above you**: a planetarium from your place (browser location, one of 6 000 cities,
  or coordinates). The sky colour follows the Sun through twilight, stars fade by day and
  toward the horizon, the Moon shows its phase, and a panel says what is up and where to
  look: planets with altitude, direction, rise and set, the Moon, active shower radiants
  with the rate to expect. The meteors the Global Meteor Network recorded over your sky
  replay where they really flashed. The place never leaves the browser.

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

### Spacecraft

Horizons answers one request at a time, so `build_craft()` in `data.php` keeps a list of
tables per craft (see `public/data/craft.json`): a whole-mission table relative to the
Sun (2 000 intervals), finer tables relative to a planet around each flyby and for whole
stays in orbit, and a fine track around today relative to the body the craft orbits.
Each table is one Horizons request; stale ones are fetched a slice at a time within the
100-second request limit (or all at once with `php public/api/data.php craft`). Coverage
comes from Horizons itself: when a span runs past the ephemeris, the error message says
where it ends and the request is retried inside it. The client takes the finest table
that covers the time, interpolates it with cubic Hermite polynomials and adds the
centre body's position, so the craft sits on the planet as astronomy-engine draws it.
Where only the coarse table covers a stay in orbit, the craft is drawn at its planet.

### Sky above you

`src/sim/sky.ts` turns J2000 directions into the local sky with astronomy-engine's
EQJ→horizon rotation (precession, nutation, the Earth's turn); stars, constellation
lines and the ecliptic share that one matrix on the GPU. Planets, the Sun and the Moon
come from `Equator()` + `Horizon()` with refraction for the numbers. The Moon is a
billboard lit from the Sun's direction in its own frame. GMN meteors within 1 100 km
become streaks between the topocentric directions of their measured begin and end points.

## Develop

```bash
npm install
npm run dev        # http://localhost:3130, the data API is proxied to the live site
npm run build
npm run assets     # planet textures (Solar System Scope, CC BY 4.0) → public/textures
npm run streams    # meteor streams from the GMN 2025 file → public/data/streams.json
npm test
```

To try `data.php` changes before deploying, run it locally with PHP 8 (curl, openssl and
zlib enabled): `php -S 127.0.0.1:3132 -t public` and `npm run dev:local`, which sends the
spacecraft endpoints there (the rest still goes to the live site); the local cache is
`data/rightnow`.

`node scripts/frames.mjs <url> <prefix> <ms,...>` and `node scripts/perf.mjs` take
screenshots and measure frame rates in headless Edge with the GPU on.

Deploy: `powershell -ExecutionPolicy Bypass -File tools\deploy.ps1 -Server user@host`
(or put `$Server = "user@host"` in an untracked `tools\deploy.local.ps1`).

## Data and credits

JPL Small-Body Database, CNEOS (close approaches, fireballs, Sentry), JPL Scout,
JPL Horizons, Global Meteor Network (CC BY 4.0), astronomy-engine (MIT),
Yale Bright Star Catalogue, constellation lines and names from d3-celestial by Olaf
Frohn (BSD 3-Clause), cities from GeoNames (CC BY 4.0), Solar System Scope textures
(CC BY 4.0), NASA Blue and Black Marble.

## License

The code is MIT (see LICENSE). The data files keep their own licences: textures and
`public/data/streams.json` / `cities.json` are CC BY 4.0 (Solar System Scope, Global
Meteor Network, GeoNames), `public/data/constellations.json` is BSD 3-Clause
(d3-celestial).
