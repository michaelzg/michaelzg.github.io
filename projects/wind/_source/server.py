#!/usr/bin/env python3
"""Current NOAA GFS winds for the Wind globe: a local preview server and a
build-time exporter. Standard library only.

GFS fields are regridded and hosted by Earth / Nullschool. EPak's PPAK blocks
store signed, variable-length integer residuals; each is reconstructed from the
preceding row and column, then scaled.

  python3 projects/wind/_source/server.py              # preview with live data
  python3 projects/wind/_source/server.py --write DIR  # write DIR/surface.json, DIR/jet.json
"""

import argparse
import copy
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
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

SOURCE_ROOT = "https://gaia.nullschool.net/data/gfs/current/"
SOURCES = {
    "surface": SOURCE_ROOT + "current-wind-surface-level-gfs-1.0.epak",
    "jet": SOURCE_ROOT + "current-wind-isobaric-250hPa-gfs-1.0.epak",
}
CACHE_SECONDS = 1800
MAX_UPSTREAM_BYTES = 4 * 1024 * 1024
USER_AGENT = "Wind/1.0 (+https://michaelzg.com/projects/wind/)"
# The page asks for api/<level>.json beside itself, which is also where the
# site build publishes the files, so one URL works locally and on a static host.
STATIC_ROUTE = re.compile(r"/api/(surface|jet)\.json$")
DECODE_ERRORS = (OSError, URLError, HTTPError, ValueError, KeyError, IndexError,
                 OverflowError, struct.error, StopIteration)
_cache = {}
_locks = {level: threading.Lock() for level in SOURCES}


def iso_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def canonical_time(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat(timespec="seconds").replace("+00:00", "Z")


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
            run = 1 + block[cursor]
            cursor += 1
            values.extend([math.nan] * run)
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


def decode_epak(payload, level, source_url, fetched_at=None):
    if len(payload) < 16 or payload[:4] != b"head":
        raise ValueError("Upstream did not return an EPak weather grid")
    header_size = struct.unpack_from(">i", payload, 4)[0]
    if not 0 < header_size < len(payload) - 12:
        raise ValueError("Invalid EPak header length")
    header = json.loads(payload[8:8 + header_size])
    cursor, blocks = 8 + header_size, []
    while cursor + 4 <= len(payload) and payload[cursor:cursor + 4] != b"tail":
        if cursor + 8 > len(payload):
            raise ValueError("Truncated EPak block")
        kind = payload[cursor:cursor + 4]
        block_size = struct.unpack_from(">i", payload, cursor + 4)[0]
        cursor += 8
        if kind != b"ppak" or block_size < 16 or cursor + block_size > len(payload):
            raise ValueError("Unsupported EPak block")
        blocks.append(decode_ppak(payload[cursor:cursor + block_size]))
        cursor += block_size
    if payload[cursor:cursor + 4] != b"tail":
        raise ValueError("Missing EPak terminator")
    variables = header["variables"]
    u = next(v for k, v in variables.items() if k.startswith("u-component_of_wind"))
    v = next(v for k, v in variables.items() if k.startswith("v-component_of_wind"))
    lat = variables[u["dimensions"][2]]["sequence"]
    lon = variables[u["dimensions"][3]]["sequence"]
    clock = variables[u["dimensions"][0]]
    width, height = lon["size"], lat["size"]
    u_values, v_values = blocks[u["data"]["block"]], blocks[v["data"]["block"]]
    if len(u_values) != width * height or len(v_values) != width * height:
        raise ValueError("Wind components do not match their coordinates")
    if lat["delta"] >= 0 or lon["delta"] <= 0:
        raise ValueError("Unexpected wind grid orientation")
    if any(x is None or abs(x) > 300 for x in u_values + v_values):
        raise ValueError("Wind grid contains invalid velocities")
    return {
        "width": width, "height": height,
        "lon0": lon["start"], "lat0": lat["start"],
        "dx": lon["delta"], "dy": lat["delta"],
        "u": u_values, "v": v_values,
        "runTime": canonical_time(clock["init-time"]),
        "validTime": canonical_time(clock["data"][0]),
        "fetchedAt": fetched_at or iso_now(),
        "source": "NOAA GFS via Earth / Nullschool",
        "sourceUrl": source_url,
        "sourceInfoUrl": "https://earth.nullschool.net/about.html",
        "model": "GFS", "level": level,
        "levelLabel": "10 m above ground" if level == "surface" else "250 hPa · ~10.5 km",
        "units": "m/s", "stale": False, "snapshot": False,
        "refreshAfterSeconds": CACHE_SECONDS,
    }


def is_stale(valid_time):
    valid = dt.datetime.fromisoformat(valid_time.replace("Z", "+00:00"))
    age = (dt.datetime.now(dt.timezone.utc) - valid).total_seconds()
    return abs(age) > 9 * 3600


def get_wind(level):
    # The per-layer lock collapses concurrent requests into one upstream fetch.
    with _locks[level]:
        entry = _cache.get(level)
        if entry and time.monotonic() - entry[0] < CACHE_SECONDS:
            result = copy.copy(entry[1])
            result["cached"] = True
            result["stale"] = is_stale(result["validTime"])
            return result
        request = Request(SOURCES[level], headers={"User-Agent": USER_AGENT, "Accept": "application/octet-stream"})
        with urlopen(request, timeout=12) as response:
            payload = response.read(MAX_UPSTREAM_BYTES + 1)
        if len(payload) > MAX_UPSTREAM_BYTES:
            raise ValueError("Upstream weather file exceeds size limit")
        result = decode_epak(payload, level, SOURCES[level])
        result["stale"] = is_stale(result["validTime"])
        result["cached"] = False
        _cache[level] = (time.monotonic(), result)
        return result


def to_json(value):
    return json.dumps(value, separators=(",", ":"), allow_nan=False).encode()


class WindHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        route = STATIC_ROUTE.search(parsed.path)
        if route:
            level = route.group(1)
        elif parsed.path == "/api/wind":
            level = parse_qs(parsed.query).get("level", ["surface"])[0]
        else:
            # A local preview: always serve the saved edits.
            del self.headers["If-Modified-Since"]
            return super().do_GET()
        if level not in SOURCES:
            return self.send_json(400, {"error": "Choose surface or jet"})
        try:
            return self.send_json(200, get_wind(level))
        except DECODE_ERRORS as error:
            self.log_error("Wind upstream unavailable: %s", error)
            return self.send_json(502, {"error": "Current NOAA GFS data could not be fetched",
                                        "detail": str(error), "sourceUrl": SOURCES[level]})

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status, value):
        body = to_json(value)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def write_current(directory):
    """Write each layer's current field; a layer that fails is left absent, so
    the page shows its dated snapshot for that layer instead."""
    directory.mkdir(parents=True, exist_ok=True)
    failed = False
    for level in SOURCES:
        try:
            result = get_wind(level)
        except DECODE_ERRORS as error:
            print(f"{level}: current field unavailable ({error})", file=sys.stderr)
            failed = True
            continue
        result.pop("cached", None)
        (directory / f"{level}.json").write_bytes(to_json(result))
        print(f"{level}: valid {result['validTime']}, model run {result['runTime']}")
    return 1 if failed else 0


def main():
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--directory", default=str(root), help="folder to serve (default: the site repository)")
    parser.add_argument("--write", metavar="DIR", type=Path, help="write current fields to DIR and exit")
    args = parser.parse_args()
    if args.write:
        return write_current(args.write)
    os.chdir(args.directory)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), WindHandler)
    print(f"Wind → http://127.0.0.1:{args.port}/projects/wind/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
