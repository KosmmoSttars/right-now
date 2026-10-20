<?php
// Right Now data endpoint. Every dataset is cached on disk and served at once; when
// a cache is older than its TTL it is rebuilt after the response has been sent, so
// visitors never wait for MPC or JPL.
//
//   ?set=manifest            asteroid catalogue manifest (counts, chunk sizes, epoch)
//   ?set=ast&v=..&part=N     asteroid chunk N: 16-byte records, see build_asteroids()
//   ?set=names&v=..&shard=K  names for records K*16384 .. K*16384+16383, one per line
//   ?set=search&q=eros       up to 20 matches: [[index, name], ...]
//   ?set=live                close approaches, fireballs, Sentry, Scout, comets, meteors
//   ?set=track&des=2026+TP35 heliocentric vectors from JPL Horizons around a close approach
//   ?set=craft               spacecraft index: coverage and a fine track around today
//   ?set=craftfile&id=juno   every JPL Horizons table of one spacecraft
//   ?set=status              cache ages (deploy check)

declare(strict_types=1);

const UA = 'RightNow/1.0 (+https://kosmo-stars.ru/now/)';
const ASTEROIDS_TTL = 5 * 24 * 3600;
const LIVE_TTL = 3600;
const CHUNK = 262144;           // records per asteroid chunk
const SHARD = 16384;            // names per shard
const A_MIN = 0.1;              // log-encoded semi-major axis range, AU
const A_MAX = 2000.0;

// Asteroid classes (keep in step with src/sim/classes.ts).
const C_MBA = 0, C_NEO = 1, C_PHA = 2, C_HUNGARIA = 3, C_HILDA = 4, C_TROJAN = 5,
      C_MARS = 6, C_CENTAUR = 7, C_TNO = 8, C_OUTER = 9;

ini_set('memory_limit', '384M');

function cache_dir(): string
{
    foreach ([__DIR__ . '/../../data/rightnow', sys_get_temp_dir() . '/rightnow'] as $dir) {
        if ((is_dir($dir) || @mkdir($dir, 0755, true)) && is_writable($dir)) return $dir;
    }
    http_response_code(500);
    exit;
}

function http_get(string $url, ?string $toFile = null, int $timeout = 60): ?string
{
    $ch = curl_init($url);
    $fh = null;
    $opts = [
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_USERAGENT => UA,
        CURLOPT_ENCODING => '',
    ];
    if ($toFile !== null) {
        $fh = fopen($toFile, 'wb');
        $opts[CURLOPT_FILE] = $fh;
    } else {
        $opts[CURLOPT_RETURNTRANSFER] = true;
    }
    curl_setopt_array($ch, $opts);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($fh) fclose($fh);
    if ($body === false || $code !== 200) {
        if ($toFile !== null) @unlink($toFile);
        return null;
    }
    return $toFile !== null ? $toFile : (string) $body;
}

/** A remote text, re-fetched only when its cached copy is older than $ttl. */
function cached_text(string $dir, string $key, string $url, int $ttl, callable $valid, int $timeout = 60): ?string
{
    $file = "$dir/raw-$key.txt";
    if (!is_file($file) || time() - filemtime($file) >= $ttl) {
        $text = http_get($url, null, $timeout);
        if ($text !== null && $valid($text)) {
            file_put_contents("$file.tmp", $text);
            rename("$file.tmp", $file);
            return $text;
        }
        if (is_file($file)) touch($file); // keep the old copy, retry after the next TTL
    }
    return is_file($file) ? (string) file_get_contents($file) : null;
}

function with_lock(string $dir, string $name, callable $fn): bool
{
    $lock = fopen("$dir/$name.lock", 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) return false;
    try {
        return (bool) $fn();
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function json_out(mixed $data): string
{
    return json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PRESERVE_ZERO_FRACTION);
}

function write_atomic(string $file, string $bytes): void
{
    file_put_contents("$file.tmp", $bytes);
    rename("$file.tmp", $file);
}

/** Sends a pre-gzipped file with caching headers. */
function send_gz(string $file, string $type, int $maxAge): void
{
    clearstatcache();
    $mtime = (int) filemtime($file);
    $etag = '"' . dechex($mtime) . '-' . dechex((int) filesize($file)) . '"';
    header("Content-Type: $type");
    header("Cache-Control: public, max-age=$maxAge");
    header("ETag: $etag");
    header('Vary: Accept-Encoding');
    header('X-Content-Type-Options: nosniff');
    header('Access-Control-Allow-Origin: *');
    if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
        http_response_code(304);
    } elseif (str_contains($_SERVER['HTTP_ACCEPT_ENCODING'] ?? '', 'gzip')) {
        header('Content-Encoding: gzip');
        header('Content-Length: ' . filesize($file));
        readfile($file);
    } else {
        echo gzdecode((string) file_get_contents($file));
    }
}

function fail(int $code, int $retry = 0): never
{
    http_response_code($code);
    if ($retry) header("Retry-After: $retry");
    header('Cache-Control: no-store');
    exit;
}

function after_response(callable $fn): void
{
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    ignore_user_abort(true);
    $fn();
}

// ------------------------------------------------------------------ dates

function jd_from_ymd(int $y, int $m, float $d): float
{
    if ($m <= 2) { $y--; $m += 12; }
    $a = intdiv($y, 100);
    $b = 2 - $a + intdiv($a, 4);
    return floor(365.25 * ($y + 4716)) + floor(30.6001 * ($m + 1)) + $d + $b - 1524.5;
}

// ------------------------------------------------------------------ asteroids

function current_version(string $dir): ?string
{
    $v = @file_get_contents("$dir/ast-current");
    return ($v !== false && is_dir("$dir/ast-$v")) ? trim($v) : null;
}

/** Our display class from the JPL orbit class plus a few named families. */
function classify(string $jpl, float $a, float $e, float $i, bool $neo, bool $pha): int
{
    if ($pha) return C_PHA;
    if ($neo || in_array($jpl, ['IEO', 'ATE', 'APO', 'AMO'], true)) return C_NEO;
    if ($jpl === 'TJN') return C_TROJAN;
    if ($jpl === 'TNO' || $a > 30.1) return C_TNO;
    if ($jpl === 'CEN' || $a > 5.5) return C_CENTAUR;
    if ($jpl === 'MCA') return C_MARS;
    if ($a > 1.78 && $a < 2.0 && $e < 0.18 && $i > 16 && $i < 34) return C_HUNGARIA;
    if ($a > 3.7 && $a < 4.2 && $e < 0.3) return C_HILDA;
    if ($a > 3.3) return C_OUTER;
    return C_MBA;
}

/** End of the work budget: PHP-FPM here kills a request after 100 s, background work included. */
function deadline(): float
{
    static $end = null;
    // CLI: unlimited, or RN_BUDGET seconds (to exercise the resumable path).
    $end ??= microtime(true) + (PHP_SAPI === 'cli' ? (float) (getenv('RN_BUDGET') ?: 1e9) : 70);
    return $end;
}

/**
 * The JPL Small-Body Database (every known asteroid, full-precision osculating
 * elements) → chunks of 16-byte little-endian records (eight uint16):
 *   0 a, log-encoded between A_MIN and A_MAX     4 ω / 360
 *   1 e                                          5 M at the common epoch / 360, coarse
 *   2 i / 180                                    6 class << 8 | round((H + 2) * 7)
 *   3 Ω / 360                                    7 M fine bits (sub-step of field 5)
 * NEOs come first, then everything else from the brightest (largest) to the faintest,
 * so a partly loaded catalogue already shows the right bodies.
 *
 * The download (32 pages of 50 000) takes minutes, longer than a web request may
 * run, so the build is resumable: each call works until the deadline and saves its
 * progress in ast-build.json; the next call carries on. Returns true once a new
 * version has gone live.
 */
function build_asteroids(string $dir): bool
{
    set_time_limit(PHP_SAPI === 'cli' ? 0 : 95);
    $stateFile = "$dir/ast-build.json";
    $st = is_file($stateFile) ? json_decode((string) file_get_contents($stateFile), true) : null;
    if (is_array($st) && time() - (int) ($st['touched'] ?? 0) > 2 * 86400) {
        rrmdir("$dir/ast-{$st['version']}"); // abandoned: start over
        $st = null;
    }
    if (!is_array($st)) {
        $st = ['version' => gmdate('YmdHis'), 'from' => 0, 'expected' => 0, 'epochRef' => null,
               'classes' => array_fill(0, 10, 0), 'total' => 0, 'touched' => time()];
        @mkdir("$dir/ast-{$st['version']}", 0755, true);
    }
    $out = "$dir/ast-{$st['version']}";
    $save = static function () use (&$st, $stateFile): void {
        $st['touched'] = time();
        write_atomic($stateFile, json_out($st));
    };
    $page = 50000;
    while ($st['from'] === 0 || $st['from'] < $st['expected']) {
        if (microtime(true) > deadline() - 20 || !asteroid_page($out, $st, $page)) {
            $save();
            return false;
        }
        $st['from'] += $page;
        $save();
    }
    if (microtime(true) > deadline() - 15) return false; // finish on the next call
    if ($st['total'] < 0.95 * $st['expected'] || $st['epochRef'] === null) {
        rrmdir($out);
        @unlink($stateFile);
        return false;
    }
    finish_asteroids($dir, $out, $st);
    @unlink($stateFile);
    return true;
}

const BUCKETS = 34; // 0: NEOs, 1..33: by absolute magnitude

/** Downloads one page of the catalogue and appends it to the bucket files. */
function asteroid_page(string $out, array &$st, int $page): bool
{
    $url = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api?fields=full_name,a,e,i,om,w,ma,epoch,H,neo,pha,class'
        . "&sb-kind=a&full-prec=true&limit=$page&limit-from={$st['from']}";
    $j = null;
    for ($try = 0; $try < 2 && !is_array($j); $try++) {
        $text = http_get($url, null, 60);
        $j = $text !== null ? json_decode($text, true) : null;
        unset($text);
        if (!is_array($j)) sleep(3);
    }
    if (!is_array($j) || !isset($j['data'])) return false;
    $st['expected'] = (int) ($j['count'] ?? 0);

    $rec = array_fill(0, BUCKETS, '');
    $nam = array_fill(0, BUCKETS, '');
    $lnMin = log(A_MIN);
    $lnSpan = log(A_MAX) - $lnMin;
    $u = static fn (float $x): int => max(0, min(65535, (int) round($x * 65535.0)));
    foreach ($j['data'] as [$name, $as, $es, $is, $oms, $ws, $mas, $eps, $hs, $neo, $pha, $jcls]) {
        $a = (float) $as;
        $e = (float) $es;
        if ($a <= A_MIN || $a >= A_MAX || $e >= 1 || $e < 0 || $mas === null || $eps === null) continue;
        $epoch = (float) $eps;
        $st['epochRef'] ??= $epoch;
        $h = ($hs === null || $hs === '') ? 25.0 : (float) $hs;
        $i = (float) $is;
        $cls = classify((string) $jcls, $a, $e, $i, $neo === 'Y', $pha === 'Y');

        $n = 0.9856076686 / ($a * sqrt($a)); // deg/day
        $m = fmod((float) $mas + $n * ($st['epochRef'] - $epoch), 360.0);
        if ($m < 0) $m += 360.0;
        $mq = $m / 360.0 * 65536.0;
        $mc = (int) floor($mq);
        $mf = (int) floor(($mq - $mc) * 65536.0);
        if ($mc > 65535) { $mc = 65535; $mf = 65535; }

        $b = ($cls === C_NEO || $cls === C_PHA) ? 0 : 1 + max(0, min(BUCKETS - 2, (int) floor($h) - 2));
        $rec[$b] .= pack('v8',
            $u((log($a) - $lnMin) / $lnSpan),
            $u($e),
            $u($i / 180.0),
            $u((float) $oms / 360.0),
            $u((float) $ws / 360.0),
            $mc,
            ($cls << 8) | max(0, min(255, (int) round(($h + 2.0) * 7.0))),
            $mf,
        );
        $nam[$b] .= trim((string) $name) . "\n";
        $st['classes'][$cls]++;
        $st['total']++;
    }
    for ($b = 0; $b < BUCKETS; $b++) {
        if ($rec[$b] === '') continue;
        file_put_contents("$out/b$b.rec", $rec[$b], FILE_APPEND);
        file_put_contents("$out/b$b.nam", $nam[$b], FILE_APPEND);
    }
    return true;
}

/** Buckets → fixed-size gzip chunks, name shards and the manifest; then goes live. */
function finish_asteroids(string $dir, string $out, array $st): void
{
    $chunks = [];
    $part = 0;
    $buf = '';
    $names = fopen("$out/names.txt", 'wb');
    for ($b = 0; $b < BUCKETS; $b++) {
        if (!is_file("$out/b$b.rec")) continue;
        $fh = fopen("$out/b$b.rec", 'rb');
        while (!feof($fh)) {
            $read = fread($fh, CHUNK * 16 - strlen($buf));
            if ($read === false || $read === '') break;
            $buf .= $read;
            if (strlen($buf) === CHUNK * 16) {
                file_put_contents("$out/ast-$part.bin.gz", gzencode($buf, 6));
                $chunks[] = CHUNK;
                $part++;
                $buf = '';
            }
        }
        fclose($fh);
        $src = fopen("$out/b$b.nam", 'rb');
        stream_copy_to_stream($src, $names);
        fclose($src);
        unlink("$out/b$b.rec");
        unlink("$out/b$b.nam");
    }
    if ($buf !== '') {
        file_put_contents("$out/ast-$part.bin.gz", gzencode($buf, 6));
        $chunks[] = strlen($buf) / 16;
    }
    fclose($names);

    $shard = 0;
    $lines = [];
    $fh = fopen("$out/names.txt", 'rb');
    while (($l = fgets($fh)) !== false) {
        $lines[] = $l;
        if (count($lines) === SHARD) {
            file_put_contents("$out/names-$shard.txt.gz", gzencode(implode('', $lines), 6));
            $shard++;
            $lines = [];
        }
    }
    if ($lines) file_put_contents("$out/names-$shard.txt.gz", gzencode(implode('', $lines), 6));
    fclose($fh);

    $classes = $st['classes'];
    $manifest = [
        'v' => $st['version'],
        'builtAt' => gmdate('Y-m-d\TH:i:s\Z'),
        'source' => 'JPL SBDB',
        'epochJd' => $st['epochRef'],
        'count' => $st['total'],
        'neoCount' => $classes[C_NEO] + $classes[C_PHA],
        'classes' => $classes,
        'chunks' => $chunks,
        'shard' => SHARD,
        'aRange' => [A_MIN, A_MAX],
    ];
    file_put_contents("$out/manifest.json.gz", gzencode(json_out($manifest), 9));

    $old = current_version($dir);
    write_atomic("$dir/ast-current", $st['version']);
    // Keep the previous version for clients that loaded its manifest a moment ago.
    foreach (glob("$dir/ast-*", GLOB_ONLYDIR) ?: [] as $d) {
        $v = substr(basename($d), 4);
        if ($v !== $st['version'] && $v !== $old) rrmdir($d);
    }
}

function rrmdir(string $d): void
{
    foreach (glob("$d/*") ?: [] as $f) is_dir($f) ? rrmdir($f) : unlink($f);
    @rmdir($d);
}

function search_names(string $dir, string $q): array
{
    $v = current_version($dir);
    if ($v === null || mb_strlen($q) < 2) return [];
    $text = (string) file_get_contents("$dir/ast-$v/names.txt");
    $needle = preg_quote(mb_strtolower(trim($q)), '/');
    // JPL full names: "433 Eros (A898 PA)", "(2024 YR4)". Exact names and numbers
    // first ("Eros" before "Anteros"), then any substring.
    $out = [];
    $seen = [];
    $patterns = [
        "/^(?:\\d+ )?$needle(?: \\(.*)?$/mi",
        "/^(?:\\d+ )?(?:\\S+ )?\\(?$needle\\)?$/mi",
        "/^(?:\\d+ )?$needle\\b.*$/mi",
        "/^.*$needle.*$/mi",
    ];
    foreach ($patterns as $re) {
        if (!preg_match_all($re, $text, $m, PREG_OFFSET_CAPTURE)) continue;
        foreach ($m[0] as [$line, $offset]) {
            if (isset($seen[$offset])) continue;
            $seen[$offset] = true;
            $out[] = [substr_count($text, "\n", 0, $offset), $line];
            if (count($out) >= 20) return $out;
        }
    }
    return $out;
}

// ------------------------------------------------------------------ live data

function jpl_json(string $dir, string $key, string $url, int $ttl): ?array
{
    $text = cached_text($dir, $key, $url, $ttl, static fn (string $t): bool => str_contains($t, '"signature"'));
    $data = $text !== null ? json_decode($text, true) : null;
    return is_array($data) ? $data : null;
}

/** Rows of a JPL {fields, data} table as associative arrays. */
function jpl_rows(?array $j): array
{
    if (!$j || empty($j['data']) || empty($j['fields'])) return [];
    return array_map(static fn ($r) => array_combine($j['fields'], $r), $j['data']);
}

function num(mixed $v): ?float
{
    return ($v === null || $v === '' || !is_numeric($v)) ? null : (float) $v;
}

function parse_comets(?array $j): array
{
    $out = [];
    foreach (jpl_rows($j) as $r) {
        $q = num($r['q']);
        $e = num($r['e']);
        $tp = num($r['tp']);
        if ($q === null || $e === null || $tp === null || $q <= 0) continue;
        $out[] = [
            trim((string) $r['full_name']), round($tp, 6), $q, $e,
            (float) $r['i'], (float) $r['om'], (float) $r['w'], num($r['M1']),
        ];
    }
    return $out;
}

/** GMN trajectory summaries: one meteor per row, columns separated by ';'. */
function parse_gmn(string $text, array &$seen): array
{
    $out = [];
    $col = null;
    foreach (preg_split('/\r?\n/', $text) as $l) {
        if ($l === '' ) continue;
        if ($l[0] === '#') continue;
        $f = array_map('trim', explode(';', $l));
        if (count($f) < 86 || !is_numeric($f[1])) continue;
        $id = $f[0];
        if (isset($seen[$id])) continue;
        $seen[$id] = true;
        // Column positions follow the GMN header (identifier = 0, each value followed by its sigma).
        $e = num($f[25]); $i = num($f[27]); $w = num($f[29]); $node = num($f[31]); $q = num($f[37]);
        $fAnom = num($f[39]);
        if ($e === null || $q === null || $i === null || $w === null || $node === null || $fAnom === null) continue;
        $out[] = [
            round((float) $f[1], 6),          // JD of the beginning, UTC
            $f[4] === '...' ? '' : $f[4],      // IAU shower code
            round($q, 5), round($e, 5), round($i, 3), round($node, 4), round($w, 4), round($fAnom, 4),
            round((float) $f[15], 2),          // Vgeo km/s
            round((float) $f[63], 4), round((float) $f[65], 4), round((float) $f[67], 1), // begin lat, lon, h
            round((float) $f[69], 4), round((float) $f[71], 4), round((float) $f[73], 1), // end lat, lon, h
            num($f[76]),                       // peak absolute magnitude
            num($f[79]),                       // mass, kg
        ];
    }
    return $out;
}

function build_live(string $dir): bool
{
    set_time_limit(PHP_SAPI === 'cli' ? 0 : 95);
    $now = time();
    $min = gmdate('Y-m-d', $now - 30 * 86400);
    $max = gmdate('Y-m-d', $now + 90 * 86400);
    $cad = jpl_json($dir, 'cad', "https://ssd-api.jpl.nasa.gov/cad.api?date-min=$min&date-max=$max&dist-max=0.05&fullname=true&diameter=true", 3 * 3600);
    $fireball = jpl_json($dir, 'fireball', 'https://ssd-api.jpl.nasa.gov/fireball.api?vel-comp=true', 12 * 3600);
    $sentry = jpl_json($dir, 'sentry', 'https://ssd-api.jpl.nasa.gov/sentry.api', 24 * 3600);
    $scout = cached_text($dir, 'scout', 'https://ssd-api.jpl.nasa.gov/scout.api', 3600, static fn (string $t): bool => str_contains($t, '"signature"'));
    $comets = jpl_json($dir, 'comets', 'https://ssd-api.jpl.nasa.gov/sbdb_query.api?fields=full_name,tp,q,e,i,om,w,M1,epoch&sb-kind=c&full-prec=true', 24 * 3600);

    // GMN: the last three daily files (about three days of meteors).
    $meteors = [];
    $listing = cached_text($dir, 'gmn-list', 'https://globalmeteornetwork.org/data/traj_summary_data/daily/', 3 * 3600, static fn (string $t): bool => str_contains($t, 'traj_summary_'));
    if ($listing !== null && preg_match_all('/href="(traj_summary_(\d{8})_solrange[^"]+\.txt)"/', $listing, $m)) {
        $files = array_unique($m[1]);
        sort($files);
        $files = array_slice($files, -3);
        $files[] = 'traj_summary_latest_daily.txt';
        $seen = [];
        foreach (array_reverse($files) as $f) {
            $ttl = str_contains($f, 'latest') ? 3 * 3600 : 30 * 86400;
            $t = cached_text($dir, 'gmn-' . preg_replace('/[^a-z0-9_]+/i', '_', $f), "https://globalmeteornetwork.org/data/traj_summary_data/daily/$f", $ttl, static fn (string $t): bool => str_contains($t, 'Unique trajectory'), 120);
            if ($t !== null) $meteors = array_merge($meteors, parse_gmn($t, $seen));
        }
        // Drop cached days that fell out of the window.
        foreach (glob("$dir/raw-gmn-traj_summary_2*") ?: [] as $old) {
            $keep = false;
            foreach ($files as $f) if (str_contains($old, preg_replace('/[^a-z0-9_]+/i', '_', $f))) $keep = true;
            if (!$keep) unlink($old);
        }
        usort($meteors, static fn ($a, $b) => $a[0] <=> $b[0]);
    }

    $approaches = [];
    foreach (jpl_rows($cad) as $r) {
        $approaches[] = [
            $r['des'], trim((string) ($r['fullname'] ?? $r['des'])), (float) $r['jd'],
            (float) $r['dist'], (float) $r['dist_min'], (float) $r['dist_max'],
            (float) $r['v_rel'], num($r['h']), num($r['diameter'] ?? null),
        ];
    }
    $fireballs = [];
    foreach (jpl_rows($fireball) as $r) {
        if ($r['lat'] === null || $r['lon'] === null) continue;
        $fireballs[] = [
            $r['date'], (float) $r['energy'], (float) $r['impact-e'],
            ($r['lat-dir'] === 'S' ? -1 : 1) * (float) $r['lat'],
            ($r['lon-dir'] === 'W' ? -1 : 1) * (float) $r['lon'],
            num($r['alt']), num($r['vel']), num($r['vx'] ?? null), num($r['vy'] ?? null), num($r['vz'] ?? null),
        ];
    }
    $risk = [];
    foreach (($sentry['data'] ?? []) as $r) {
        $risk[] = [$r['des'], trim((string) ($r['fullname'] ?? $r['des'])), num($r['ip']), num($r['ps_cum']), (int) ($r['ts_max'] ?? 0), num($r['diameter'] ?? null), (string) ($r['range'] ?? '')];
    }
    $scoutRows = [];
    foreach ((json_decode((string) $scout, true)['data'] ?? []) as $r) {
        $scoutRows[] = [$r['objectName'], num($r['H']), (int) $r['neoScore'], (int) $r['phaScore'], num($r['caDist']), num($r['vInf']), (int) $r['nObs'], num($r['arc']), (string) $r['lastRun']];
    }

    $bundle = [
        'v' => 1,
        'builtAt' => gmdate('Y-m-d\TH:i:s\Z'),
        'approaches' => $approaches,
        'fireballs' => $fireballs,
        'sentry' => $risk,
        'scout' => $scoutRows,
        'comets' => parse_comets($comets),
        'meteors' => $meteors,
    ];
    if (!$approaches && !$bundle['comets']) return false;
    write_atomic("$dir/live.json.gz", gzencode(json_out($bundle), 9));

    // Warm the Horizons tracks of the approaches around now, nearest first.
    $nowJd = time() / 86400 + 2440587.5;
    $soon = array_filter($approaches, static fn ($a) => abs($a[2] - $nowJd) < 8);
    usort($soon, static fn ($a, $b) => abs($a[2] - $nowJd) <=> abs($b[2] - $nowJd));
    foreach ($soon as $a) {
        if (microtime(true) > deadline() - 12) break; // the rest on demand or next time
        ensure_track($dir, $a[0], $a[2]);
    }
    return true;
}

// ------------------------------------------------------------------ Horizons

function build_track(string $dir, string $des, float $jd): ?string
{
    $start = $jd - 6;
    $stop = $jd + 6;
    $fmt = static fn (float $j): string => 'JD' . number_format($j, 4, '.', '');
    $q = http_build_query([
        'format' => 'json',
        'COMMAND' => "'DES=$des;'",
        'OBJ_DATA' => 'NO', 'MAKE_EPHEM' => 'YES', 'EPHEM_TYPE' => 'VECTORS',
        'CENTER' => "'500@10'", 'REF_PLANE' => 'ECLIPTIC', 'VEC_TABLE' => '2', 'OUT_UNITS' => 'AU-D',
        'START_TIME' => "'" . $fmt($start) . "'", 'STOP_TIME' => "'" . $fmt($stop) . "'",
        'STEP_SIZE' => "'1h'", 'CSV_FORMAT' => 'YES', 'VEC_LABELS' => 'NO',
    ]);
    $text = http_get("https://ssd.jpl.nasa.gov/api/horizons.api?$q", null, 60);
    $j = $text !== null ? json_decode($text, true) : null;
    $res = is_array($j) ? (string) ($j['result'] ?? '') : '';
    if (!preg_match('/\$\$SOE(.*)\$\$EOE/s', $res, $m)) return null;
    $rows = [];
    foreach (preg_split('/\r?\n/', trim($m[1])) as $l) {
        $f = array_map('trim', explode(',', $l));
        if (count($f) < 8) continue;
        // JD TDB, position AU, velocity AU/day (ecliptic J2000, heliocentric).
        $rows[] = [(float) $f[0], (float) $f[2], (float) $f[3], (float) $f[4], (float) $f[5], (float) $f[6], (float) $f[7]];
    }
    if (count($rows) < 10) return null;
    return json_out(['des' => $des, 'frame' => 'ecliptic-j2000-helio', 'time' => 'TDB', 'rows' => $rows]);
}

function track_file(string $dir, string $des, float $jd): string
{
    return "$dir/track-" . preg_replace('/[^A-Za-z0-9]+/', '_', $des) . '-' . (int) $jd . '.json.gz';
}

/**
 * The cached Horizons track for one close approach, fetched if missing. Horizons
 * turns away parallel requests, so fetches are serialised; failures are remembered
 * for a while so a burst of visitors does not hammer it.
 */
function ensure_track(string $dir, string $des, float $jd): ?string
{
    $file = track_file($dir, $des, $jd);
    if (is_file($file) && time() - filemtime($file) < 2 * 86400) return $file;
    $failed = "$file.failed";
    if (is_file($failed) && time() - filemtime($failed) < 900) return is_file($file) ? $file : null;
    $got = horizons_serial($dir, 40, static function () use ($dir, $des, $jd, $file, $failed): ?string {
        clearstatcache();
        if (is_file($file) && time() - filemtime($file) < 2 * 86400) return $file; // fetched while we waited
        $json = build_track($dir, $des, $jd);
        if ($json === null) {
            touch($failed);
            return null;
        }
        write_atomic($file, gzencode($json, 9));
        @unlink($failed);
        return $file;
    });
    if (random_int(0, 20) === 0) {
        foreach (glob("$dir/track-*") ?: [] as $f) if (time() - filemtime($f) > 14 * 86400) unlink($f);
    }
    return $got ?? (is_file($file) ? $file : null);
}

/**
 * Runs $fn while holding the Horizons lock (Horizons turns away parallel requests,
 * so every call to it from this site goes one at a time). Null if the lock could not
 * be had within $wait seconds.
 */
function horizons_serial(string $dir, float $wait, callable $fn): mixed
{
    $lock = fopen("$dir/horizons.lock", 'c');
    if (!$lock) return null;
    $t0 = microtime(true);
    while (!flock($lock, LOCK_EX | LOCK_NB)) {
        if (microtime(true) - $t0 > $wait) { fclose($lock); return null; }
        usleep(200000);
    }
    try {
        return $fn();
    } finally {
        usleep(300000); // a breath between requests
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

// ------------------------------------------------------------------ spacecraft

const HZ_CENTER = ['sun' => 10, 'mercury' => 199, 'venus' => 299, 'earth' => 399, 'mars' => 499,
                   'jupiter' => 599, 'saturn' => 699, 'uranus' => 799, 'neptune' => 899, 'pluto' => 999];
const CRAFT_END = 2465424.5;    // 2038-01-01: no point predicting active missions further
const CRAFT_ROWS = 2000;        // intervals of a whole-mission (cruise) table

function craft_config(): array
{
    $j = json_decode((string) @file_get_contents(__DIR__ . '/../data/craft.json'), true);
    return is_array($j['craft'] ?? null) ? $j['craft'] : [];
}

function jd_from_iso(string $date): float
{
    [$y, $m, $d] = array_map('intval', explode('-', $date));
    return jd_from_ymd($y, $m, $d);
}

/** "A.D. 1977-SEP-05 13:59:24.3830" (from a Horizons message) → JD. */
function jd_from_horizons(string $s): ?float
{
    if (!preg_match('/(\d{4})-([A-Z]{3})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i', $s, $m)) return null;
    $mon = array_search(strtoupper($m[2]), ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], true);
    if ($mon === false) return null;
    return jd_from_ymd((int) $m[1], $mon + 1, (int) $m[3] + ((int) $m[4] + ((int) $m[5] + (float) $m[6] / 60) / 60) / 24);
}

/** Step size in days of a Horizons step string ("6h", "2m", "1d"). */
function step_days(string $step): float
{
    if (!preg_match('/^(\d+(?:\.\d+)?)([dhm])$/', $step, $m)) return 1.0;
    return (float) $m[1] / ['d' => 1, 'h' => 24, 'm' => 1440][$m[2]];
}

/**
 * Evenly spaced state vectors of a spacecraft relative to a body, ecliptic J2000,
 * AU and AU/day. $step is a Horizons step ("1h") or null for CRAFT_ROWS intervals.
 * The span is clipped to the ephemeris when Horizons says it is out of range.
 * Returns ['t0' => JD, 'dt' => days, 'rows' => [[x, y, z, vx, vy, vz], ...]] or null.
 */
function horizons_vectors(string $hz, string $center, float $start, float $stop, ?string $step): ?array
{
    for ($try = 0; $try < 4; $try++) {
        if ($stop - $start < 1 / 24) return null;
        $n = $step === null ? CRAFT_ROWS : (int) ceil(($stop - $start) / step_days($step));
        if ($n > 12000) $step = null; // keep tables bounded
        $q = http_build_query([
            'format' => 'json', 'COMMAND' => "'$hz'", 'OBJ_DATA' => 'NO', 'MAKE_EPHEM' => 'YES',
            'EPHEM_TYPE' => 'VECTORS', 'CENTER' => "'500@" . HZ_CENTER[$center] . "'", 'REF_PLANE' => 'ECLIPTIC',
            'VEC_TABLE' => '2', 'OUT_UNITS' => 'AU-D', 'CSV_FORMAT' => 'YES', 'VEC_LABELS' => 'NO',
            'START_TIME' => "'JD" . number_format($start, 6, '.', '') . "'",
            'STOP_TIME' => "'JD" . number_format($stop, 6, '.', '') . "'",
            'STEP_SIZE' => "'" . ($step ?? (string) CRAFT_ROWS) . "'",
        ]);
        $text = http_get("https://ssd.jpl.nasa.gov/api/horizons.api?$q", null, 90);
        $j = $text !== null ? json_decode($text, true) : null;
        $res = is_array($j) ? (string) ($j['result'] ?? '') : '';
        if ($res === '') return null;
        if (preg_match('/No ephemeris for target.*?prior to (.*?)TDB/s', $res, $m) && ($jd = jd_from_horizons($m[1])) !== null) {
            $start = $jd + 1 / 1440;
            continue;
        }
        if (preg_match('/No ephemeris for target.*?after (.*?)TDB/s', $res, $m) && ($jd = jd_from_horizons($m[1])) !== null) {
            $stop = $jd - 1 / 1440;
            continue;
        }
        if (!preg_match('/\$\$SOE(.*)\$\$EOE/s', $res, $m)) return null;
        $t = [];
        $rows = [];
        // Body-centred tables need metres, heliocentric ones a few hundred metres.
        $dp = $center === 'sun' ? 9 : 11;
        foreach (preg_split('/\r?\n/', trim($m[1])) as $l) {
            $f = array_map('trim', explode(',', $l));
            if (count($f) < 8) continue;
            $t[] = (float) $f[0];
            $rows[] = [round((float) $f[2], $dp), round((float) $f[3], $dp), round((float) $f[4], $dp),
                       round((float) $f[5], $dp + 2), round((float) $f[6], $dp + 2), round((float) $f[7], $dp + 2)];
        }
        if (count($rows) < 2) return null;
        return ['t0' => $t[0], 'dt' => ($t[count($t) - 1] - $t[0]) / (count($t) - 1), 'rows' => $rows];
    }
    return null;
}

/** Every table the spacecraft layer needs, with how long each stays fresh. */
function craft_jobs(array $craft, float $nowJd): array
{
    $jobs = [];
    foreach ($craft as $c) {
        $id = $c['id'];
        $historic = !empty($c['historic']);
        $launch = jd_from_iso($c['launch']) - 1;
        $jobs["$id-cruise"] = ['craft' => $c, 'center' => 'sun', 'start' => $launch,
            'stop' => $historic ? CRAFT_END + 36525 : CRAFT_END, 'step' => null,
            'ttl' => ($historic ? 180 : 7) * 86400, 'kind' => 'cruise'];
        foreach ($c['flybys'] ?? [] as $k => [$body, $date, $half, $step]) {
            $jd = jd_from_iso($date);
            $jobs["$id-fb$k"] = ['craft' => $c, 'center' => $body, 'start' => $jd - $half, 'stop' => $jd + $half,
                'step' => $step, 'ttl' => ($jd < $nowJd - 30 ? 180 : 7) * 86400, 'kind' => 'flyby'];
        }
        foreach ($c['visits'] ?? [] as $k => $v) {
            $from = jd_from_iso($v['from']);
            $to = isset($v['to']) ? jd_from_iso($v['to']) : CRAFT_END;
            if (isset($v['step'])) {
                $jobs["$id-v$k"] = ['craft' => $c, 'center' => $v['body'], 'start' => $from, 'stop' => $to,
                    'step' => $v['step'], 'ttl' => ($to < $nowJd ? 180 : 7) * 86400, 'kind' => 'visit'];
            }
        }
        if ($historic) continue;
        // A fine track around today: relative to the body it orbits, or to the Sun.
        $now = null;
        foreach ($c['visits'] ?? [] as $v) {
            $from = jd_from_iso($v['from']);
            $to = isset($v['to']) ? jd_from_iso($v['to']) : INF;
            if (isset($v['now']) && $nowJd > $from && $nowJd < $to) $now = [$v['body'], $v['now'][0], (float) $v['now'][1]];
        }
        $now ??= ['sun', $c['nowStep'] ?? '6h', 45.0];
        $jobs["$id-now"] = ['craft' => $c, 'center' => $now[0], 'start' => $nowJd - $now[2], 'stop' => $nowJd + $now[2],
            'step' => $now[1], 'ttl' => 86400, 'kind' => 'now'];
    }
    return $jobs;
}

/**
 * Fetches stale spacecraft tables until the work budget runs out (one Horizons call
 * at a time), then rebuilds the files the client reads:
 *   craft.json.gz          index: per craft its coverage and the fine "now" track
 *   craft-<id>.json.gz     every table of one craft
 * Each table is ['c' => centre body, 'k' => kind, 't0', 'dt', 'rows'].
 * Returns true when no table is stale any more.
 */
function build_craft(string $dir): bool
{
    set_time_limit(PHP_SAPI === 'cli' ? 0 : 95);
    $craft = craft_config();
    if (!$craft) return false;
    @mkdir("$dir/craft", 0755, true);
    $nowJd = time() / 86400 + 2440587.5;
    $jobs = craft_jobs($craft, $nowJd);
    $changed = !is_file("$dir/craft.json.gz");
    $pending = 0;
    foreach ($jobs as $key => $job) {
        $file = "$dir/craft/$key.json";
        if (is_file($file) && time() - filemtime($file) < $job['ttl']) continue;
        $failed = "$file.failed";
        if (is_file($failed) && time() - filemtime($failed) < 3600) continue;
        if ($job['kind'] === 'now' && is_file($cf = "$dir/craft/{$job['craft']['id']}-cruise.json")) {
            $cr = json_decode((string) file_get_contents($cf), true);
            if ($cr['t0'] + $cr['dt'] * (count($cr['rows']) - 1) < $job['start']) continue; // mission over
        }
        if (microtime(true) > deadline() - 15) { $pending++; continue; }
        $t = horizons_serial($dir, 30, static fn () => horizons_vectors($job['craft']['hz'], $job['center'], $job['start'], $job['stop'], $job['step']));
        if ($t === null) {
            touch($failed);
            if (PHP_SAPI === 'cli') fwrite(STDERR, "  $key: failed\n");
            continue;
        }
        write_atomic($file, json_out(['c' => $job['center'], 'k' => $job['kind']] + $t));
        @unlink($failed);
        $changed = true;
        if (PHP_SAPI === 'cli') fwrite(STDERR, sprintf("  %s: %d rows\n", $key, count($t['rows'])));
    }
    if ($changed) {
        $index = [];
        foreach ($craft as $c) {
            $tables = [];
            foreach ($jobs as $key => $job) {
                if ($job['craft']['id'] !== $c['id'] || !is_file("$dir/craft/$key.json")) continue;
                $tables[] = json_decode((string) file_get_contents("$dir/craft/$key.json"), true);
            }
            $cruise = array_values(array_filter($tables, static fn ($t) => $t['k'] === 'cruise'))[0] ?? null;
            if (!$cruise) continue;
            write_atomic("$dir/craft-{$c['id']}.json.gz", gzencode(json_out(['id' => $c['id'], 'tables' => $tables]), 9));
            $last = $cruise['t0'] + $cruise['dt'] * (count($cruise['rows']) - 1);
            // The index carries only two days either side of now: enough to place
            // every craft at once; the rest comes with the craft's own file.
            $now = array_values(array_filter($tables, static fn ($t) => $t['k'] === 'now'))[0] ?? null;
            if ($now) {
                $k0 = max(0, (int) floor(($nowJd - 2 - $now['t0']) / $now['dt']));
                $k1 = min(count($now['rows']) - 1, (int) ceil(($nowJd + 2 - $now['t0']) / $now['dt']));
                $now = $k1 - $k0 >= 1
                    ? ['t0' => $now['t0'] + $k0 * $now['dt'], 'rows' => array_slice($now['rows'], $k0, $k1 - $k0 + 1)] + $now
                    : null;
            }
            $index[$c['id']] = ['cov' => [$cruise['t0'], $last], 'now' => $now];
        }
        write_atomic("$dir/craft.json.gz", gzencode(json_out(['v' => 1, 'builtAt' => gmdate('Y-m-d\TH:i:s\Z'), 'craft' => $index]), 9));
        foreach (glob("$dir/craft-*.json.gz") ?: [] as $f) {
            if (!isset($index[substr(basename($f), 6, -8)])) unlink($f);
        }
    }
    return $pending === 0;
}

// ------------------------------------------------------------------ routing

$dir = cache_dir();

// CLI: `php data.php asteroids|live|craft` rebuilds a cache in the foreground (deploy, cron).
if (PHP_SAPI === 'cli') {
    $job = $argv[1] ?? '';
    $t = microtime(true);
    $ok = match ($job) {
        'asteroids' => with_lock($dir, 'asteroids', static fn () => build_asteroids($dir)),
        'live' => with_lock($dir, 'live', static fn () => build_live($dir)),
        'craft' => with_lock($dir, 'craft', static fn () => build_craft($dir)),
        default => false,
    };
    fwrite(STDERR, sprintf("%s: %s in %.1f s, peak %d MB
", $job ?: '(none)', $ok ? 'ok' : 'failed', microtime(true) - $t, memory_get_peak_usage() >> 20));
    exit($ok ? 0 : 1);
}

$set = (string) ($_GET['set'] ?? '');

switch ($set) {
    case 'status':
        header('Content-Type: application/json');
        header('Cache-Control: no-store');
        $v = current_version($dir);
        echo json_out([
            'asteroids' => $v,
            'live' => is_file("$dir/live.json.gz") ? gmdate('c', (int) filemtime("$dir/live.json.gz")) : null,
            'craft' => is_file("$dir/craft.json.gz") ? gmdate('c', (int) filemtime("$dir/craft.json.gz")) : null,
        ]);
        exit;

    case 'manifest':
        $v = current_version($dir);
        if ($v === null) {
            // First request ever: build in the background and ask the client to retry.
            header('Retry-After: 90');
            http_response_code(503);
            after_response(static fn () => with_lock($dir, 'asteroids', static fn () => build_asteroids($dir)));
            exit;
        }
        send_gz("$dir/ast-$v/manifest.json.gz", 'application/json; charset=utf-8', 600);
        $built = (int) filemtime("$dir/ast-$v/manifest.json.gz");
        // Due for a rebuild, or one is under way: do the next slice of it.
        if (time() - $built > ASTEROIDS_TTL || is_file("$dir/ast-build.json")) {
            after_response(static fn () => with_lock($dir, 'asteroids', static fn () => build_asteroids($dir)));
        }
        exit;

    case 'ast':
    case 'names':
        $v = preg_replace('/\D/', '', (string) ($_GET['v'] ?? ''));
        $n = (int) ($_GET[$set === 'ast' ? 'part' : 'shard'] ?? -1);
        $file = $set === 'ast' ? "$dir/ast-$v/ast-$n.bin.gz" : "$dir/ast-$v/names-$n.txt.gz";
        if ($v === '' || $n < 0 || !is_file($file)) fail(404);
        // Versioned URLs never change.
        send_gz($file, $set === 'ast' ? 'application/octet-stream' : 'text/plain; charset=utf-8', 30 * 86400);
        exit;

    case 'search':
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: public, max-age=3600');
        echo json_out(search_names($dir, (string) ($_GET['q'] ?? '')));
        exit;

    case 'live':
        $file = "$dir/live.json.gz";
        if (!is_file($file) && !with_lock($dir, 'live', static fn () => build_live($dir))) fail(503, 30);
        send_gz($file, 'application/json; charset=utf-8', 300);
        if (time() - filemtime($file) > LIVE_TTL) {
            after_response(static fn () => with_lock($dir, 'live', static fn () => build_live($dir)));
        }
        exit;

    case 'craft':
        $file = "$dir/craft.json.gz";
        if (!is_file($file)) {
            header('Retry-After: 90');
            http_response_code(503);
            after_response(static fn () => with_lock($dir, 'craft', static fn () => build_craft($dir)));
            exit;
        }
        send_gz($file, 'application/json; charset=utf-8', 600);
        // Daily tracks and weekly predictions: refresh a slice at a time.
        if (time() - filemtime($file) > 6 * 3600 || random_int(0, 30) === 0) {
            after_response(static fn () => with_lock($dir, 'craft', static fn () => build_craft($dir)));
        }
        exit;

    case 'craftfile':
        $id = preg_replace('/[^a-z0-9]/', '', (string) ($_GET['id'] ?? ''));
        $file = "$dir/craft-$id.json.gz";
        if ($id === '' || !is_file($file)) fail(404);
        send_gz($file, 'application/json; charset=utf-8', 3600);
        exit;

    case 'track':
        $des = trim((string) ($_GET['des'] ?? ''));
        $jd = (float) ($_GET['jd'] ?? 0);
        if (!preg_match('/^[A-Za-z0-9 \-\/()]{2,40}$/', $des) || $jd < 2400000 || $jd > 2500000) fail(400);
        $file = ensure_track($dir, $des, $jd);
        if ($file === null) fail(502, 600);
        send_gz($file, 'application/json; charset=utf-8', 3600);
        exit;

    default:
        fail(404);
}
