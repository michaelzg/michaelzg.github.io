#!/usr/bin/env python3
"""Current winds and named storms for the Wind globe: a local preview server and
a build-time exporter, standard library only.

  python3 projects/wind/_source/server.py              # preview at http://127.0.0.1:8766/projects/wind/
  python3 projects/wind/_source/server.py --write DIR  # write DIR/surface.json, jet.json, storms.json

Winds are NOAA GFS fields regridded to 1° and hosted by Earth / Nullschool as
EPak files, whose PPAK blocks store signed, variable-length integer residuals:
each value is rebuilt from the preceding row and column, then scaled. Storms
come from the tropical cyclone vitals that started the same GFS run: one line
per active storm from the warning centers, with its position and peak wind.
"""

import argparse
import datetime as dt
import json
import math
import os
from pathlib import Path
import re
import struct
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen

SOURCES = {level: f"https://gaia.nullschool.net/data/gfs/current/current-wind-{name}-gfs-1.0.epak"
           for level, name in [("surface", "surface-level"), ("jet", "isobaric-250hPa")]}
VITALS_URL = ("https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/"
              "gfs.{run:%Y%m%d}/{run:%H}/atmos/gfs.t{run:%H}z.syndata.tcvitals.tm00")
NHC_STORMS_URL = "https://www.nhc.noaa.gov/CurrentStorms.json"
# Peak sustained wind, m/s: 34 knots makes a tropical storm; 64 knots a
# hurricane, typhoon or cyclone, by the basin letter that ends the storm's id.
TROPICAL_STORM, HURRICANE = 17.5, 32.9
BASIN_WORDS = {"L": "Hurricane", "E": "Hurricane", "C": "Hurricane", "W": "Typhoon"}
NHC_BASINS = {"al": "L", "ep": "E", "cp": "C"}
NHC_WORDS = {"HU": "Hurricane", "TS": "Tropical Storm", "STS": "Subtropical Storm"}
# center, id, name, date, time, latitude, longitude, then five fields before the peak wind
VITALS_LINE = re.compile(r"^\S+\s+(\d\d[A-Z])\s+(\S+)\s+\d{8}\s+\d{4}\s+(\d+)([NS])\s+(\d+)([EW])(?:\s+\S+){5}\s+(\d+)")
# The page asks for api/<name>.json beside itself, where the site build also
# publishes the files, so one URL works here and on a static host.
ROUTE = re.compile(r"/api/(surface|jet|storms)\.json$")
CACHE_SECONDS = 1800
MAX_BYTES = 4 * 1024 * 1024
USER_AGENT = "Wind/1.0 (+https://michaelzg.com/projects/wind/)"
ERRORS = (OSError, ValueError, KeyError, IndexError, OverflowError, struct.error, StopIteration)
_cache = {}
_lock = threading.RLock()  # collapses concurrent requests into one upstream fetch


def iso(value):
    time = dt.datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value
    return time.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch(url):
    with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=12) as response:
        payload = response.read(MAX_BYTES + 1)
    if len(payload) > MAX_BYTES:
        raise ValueError("Upstream file exceeds size limit")
    return payload


def cached(key, make):
    with _lock:
        at, value = _cache.get(key, (-math.inf, None))
        if time.monotonic() - at > CACHE_SECONDS:
            value = make()
            _cache[key] = (time.monotonic(), value)
        return value


def decode_ppak(block):
    """Decode the PPAK integer residual grid used by the upstream EPak file."""
    if len(block) < 16:
        raise ValueError("Truncated PPAK block")
    cols, rows, grids, exponent = struct.unpack_from(">iiif", block)
    count = cols * rows * grids
    if min(cols, rows, grids) < 1 or count > 2_000_000 or not math.isfinite(exponent):
        raise ValueError("Unsupported PPAK dimensions")
    values = []
    cursor = 16
    while cursor < len(block) and len(values) < count:
        prefix = block[cursor]
        cursor += 1
        if prefix == 255:
            if cursor >= len(block):
                raise ValueError("Truncated PPAK missing run")
            values.extend([math.nan] * (1 + block[cursor]))
            cursor += 1
            continue
        if prefix < 128:
            bits, extra, value = 7, 0, prefix
        elif prefix < 192:
            bits, extra, value = 14, 1, prefix & 63
        elif prefix < 224:
            bits, extra, value = 21, 2, prefix & 31
        elif prefix < 240:
            bits, extra, value = 28, 3, prefix & 15
        else:
            bits, extra, value = 32, 4, 0
        if cursor + extra > len(block):
            raise ValueError("Truncated PPAK integer")
        for byte in block[cursor:cursor + extra]:
            value = (value << 8) | byte
        cursor += extra
        if value & (1 << (bits - 1)):
            value -= 1 << bits
        values.append(float(value))
    if len(values) != count or cursor != len(block):
        raise ValueError("PPAK sample count does not match grid")
    for plane in range(grids):
        start = plane * rows * cols
        for col in range(1, cols):
            pos = start + col
            left = values[pos - 1]
            values[pos] += left if math.isfinite(left) else 0
        for row in range(1, rows):
            pos = start + row * cols
            above = values[pos - cols]
            values[pos] += above if math.isfinite(above) else 0
            for col in range(1, cols):
                pos = start + row * cols + col
                left, above, diagonal = values[pos - 1], values[pos - cols], values[pos - cols - 1]
                predictor = left + above - diagonal
                if not math.isfinite(predictor):
                    predictor = next((n for n in [left, above, diagonal] if math.isfinite(n)), 0)
                values[pos] += predictor
    scale = 10 ** exponent
    return [round(v / scale, 3) if math.isfinite(v) else None for v in values]


def decode_epak(payload, level):
    if payload[:4] != b"head":
        raise ValueError("Upstream did not return an EPak weather grid")
    header_size = struct.unpack_from(">i", payload, 4)[0]
    header = json.loads(payload[8:8 + header_size])
    cursor, blocks = 8 + header_size, []
    while payload[cursor:cursor + 4] == b"ppak":
        size = struct.unpack_from(">i", payload, cursor + 4)[0]
        blocks.append(decode_ppak(payload[cursor + 8:cursor + 8 + size]))
        cursor += 8 + size
    if payload[cursor:cursor + 4] != b"tail":
        raise ValueError("Unsupported or truncated EPak file")
    variables = header["variables"]
    u = next(v for k, v in variables.items() if k.startswith("u-component_of_wind"))
    v = next(v for k, v in variables.items() if k.startswith("v-component_of_wind"))
    clock, lat, lon = (variables[u["dimensions"][i]] for i in (0, 2, 3))
    u_values, v_values = blocks[u["data"]["block"]], blocks[v["data"]["block"]]
    width, height = lon["sequence"]["size"], lat["sequence"]["size"]
    if len(u_values) != width * height or len(v_values) != width * height:
        raise ValueError("Wind components do not match their coordinates")
    if lat["sequence"]["delta"] >= 0 or lon["sequence"]["delta"] <= 0:
        raise ValueError("Unexpected wind grid orientation")
    if any(x is None or abs(x) > 300 for x in u_values + v_values):
        raise ValueError("Wind grid contains invalid velocities")
    return {
        "width": width, "height": height,
        "lon0": lon["sequence"]["start"], "lat0": lat["sequence"]["start"],
        "dx": lon["sequence"]["delta"], "dy": lat["sequence"]["delta"],
        "u": u_values, "v": v_values, "level": level,
        "runTime": iso(clock["init-time"]), "validTime": iso(clock["data"][0]),
        "fetchedAt": iso(dt.datetime.now(dt.timezone.utc)),
    }


def nhc_classes():
    """NHC's own class for each of its storms, keyed like vitals ids ("21E").
    It knows when a storm has become post-tropical; the vitals do not."""
    try:
        storms = json.loads(fetch(NHC_STORMS_URL))["activeStorms"]
    except (*ERRORS, TypeError):
        return {}
    return {f"{s['id'][2:4]}{NHC_BASINS.get(s['id'][:2], '?')}": s["classification"] for s in storms}


def storms_for_run(run_time, classes):
    """Storms of tropical-storm strength or more from one run's vitals."""
    storms = []
    for line in fetch(VITALS_URL.format(run=dt.datetime.fromisoformat(run_time[:-1]))).decode("ascii", "replace").splitlines():
        match = VITALS_LINE.match(line)
        if not match:
            continue
        storm_id, name, lat, ns, lon, ew, wind = match.groups()
        if int(storm_id[:2]) >= 90:
            continue  # a disturbance under watch, not a storm
        wind = float(wind)
        if storm_id in classes:
            kind = NHC_WORDS.get(classes[storm_id])
        else:
            kind = (BASIN_WORDS.get(storm_id[2], "Cyclone") if wind >= HURRICANE
                    else "Tropical Storm" if wind >= TROPICAL_STORM else None)
        if kind:
            storms.append({"name": name.capitalize(), "kind": kind, "maxWind": wind,
                           "lat": int(lat) / 10 * (1 if ns == "N" else -1),
                           "lon": int(lon) / 10 * (1 if ew == "E" else -1)})
    return {"runTime": run_time, "storms": storms}


def current(name):
    if name in SOURCES:
        return cached(name, lambda: decode_epak(fetch(SOURCES[name]), name))
    run_time = current("surface")["runTime"]
    return cached(f"storms {run_time}", lambda: storms_for_run(run_time, nhc_classes()))


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        route = ROUTE.search(self.path.split("?")[0])
        if not route:
            return super().do_GET()
        try:
            body = json.dumps(current(route.group(1)), separators=(",", ":")).encode()
        except ERRORS as error:
            self.log_error("Upstream unavailable: %s", error)
            return self.send_error(502, "The forecast could not be fetched")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def write_current(directory):
    """Write each current file; one that fails is left out, and the page falls
    back to its saved copy for it."""
    directory.mkdir(parents=True, exist_ok=True)
    failed = False
    for name in [*SOURCES, "storms"]:
        try:
            (directory / f"{name}.json").write_text(json.dumps(current(name), separators=(",", ":")))
            print(f"{name}: written")
        except ERRORS as error:
            print(f"{name}: unavailable ({error})", file=sys.stderr)
            failed = True
    return int(failed)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--write", metavar="DIR", type=Path, help="write the current files to DIR and exit")
    args = parser.parse_args()
    if args.write:
        return write_current(args.write)
    os.chdir(Path(__file__).resolve().parents[3])  # serve the site repository
    print(f"Wind → http://127.0.0.1:{args.port}/projects/wind/", flush=True)
    try:
        ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(main())
