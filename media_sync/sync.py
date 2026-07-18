#!/usr/bin/env python3
"""
media_sync/sync.py
------------------
Polls the Ads Manager API and keeps a local folder in sync with
all ACTIVE media (images + videos).

Configuration: edit config.ini in the same folder as this script.

Usage:
    python3 sync.py
    python3 sync.py --config /path/to/custom_config.ini
"""

import json
import os
import sys
import time
import shutil
import logging
import argparse
import hashlib
import configparser
from datetime import datetime, date, time as _time
from pathlib import Path
from urllib.parse import urlparse

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: run  pip3 install requests")


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def load_config(config_path: str) -> configparser.ConfigParser:
    cfg = configparser.ConfigParser()
    if not cfg.read(config_path):
        sys.exit(f"Config file not found: {config_path}")
    return cfg


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def setup_logging(log_file: str) -> logging.Logger:
    logger = logging.getLogger("media_sync")
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s",
                             datefmt="%Y-%m-%d %H:%M:%S")

    # Always log to console
    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    # Optionally log to file
    if log_file.strip():
        Path(log_file).parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(log_file)
        fh.setFormatter(fmt)
        logger.addHandler(fh)

    return logger


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

def fetch_playlist(api_url: str, logger: logging.Logger):
    """GET /api/playlist/sync/ — returns ALL active ads regardless of schedule.
    Files are pre-positioned so they're ready when their time window opens."""
    url = f"{api_url.rstrip('/')}/api/playlist/sync/"
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.ConnectionError:
        logger.warning(f"Cannot reach server at {url} — will retry next cycle.")
        return None
    except requests.exceptions.Timeout:
        logger.warning("Request timed out — will retry next cycle.")
        return None
    except Exception as exc:
        logger.error(f"Unexpected error fetching playlist: {exc}")
        return None


def fetch_and_save_config(api_url: str, download_folder: Path, logger: logging.Logger):
    """GET /api/playlist/config/ and write config.json next to the media files.
    CCU reads this file to know which zone/station each ad targets."""
    url = f"{api_url.rstrip('/')}/api/playlist/config/"
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        config_path = download_folder / "config.json"
        config_path.write_text(resp.text, encoding='utf-8')
        logger.info(f"  Config written: {config_path}")
    except Exception as exc:
        logger.warning(f"  Could not fetch ad config: {exc}")


# ---------------------------------------------------------------------------
# Heartbeat helpers
# ---------------------------------------------------------------------------

def _ad_is_live(ad, now_dt):
    """Return True if an ad entry from config.json is live at now_dt."""
    today = now_dt.date()
    t = now_dt.time()
    sd = ad.get('start_date')
    ed = ad.get('end_date')
    ds = ad.get('daily_start_time')
    de = ad.get('daily_end_time')
    if sd and today < date.fromisoformat(sd):
        return False
    if ed and today > date.fromisoformat(ed):
        return False
    if ds and de:
        t_s = _time.fromisoformat(ds)
        t_e = _time.fromisoformat(de)
        if t_s <= t_e:
            if not (t_s <= t <= t_e):
                return False
        else:
            if not (t >= t_s or t <= t_e):
                return False
    return True


def build_active_ads(config_json_path: Path, now_dt: datetime, device_zone: str = '', device_station: str = ''):
    """Read config.json, filter to currently-live ads for this device, return active_ads list."""
    try:
        data = json.loads(config_json_path.read_text(encoding='utf-8'))
    except Exception:
        return []

    active = []
    for ad in data.get('ads', []):
        if not _ad_is_live(ad, now_dt):
            continue
        # Check targeting
        target_type = ad.get('target_type', 'zone')
        targets = ad.get('targets', [])
        if target_type == 'zone' and device_zone and targets:
            if device_zone not in targets:
                continue
        elif target_type == 'station' and device_station and targets:
            if device_station not in targets:
                continue
        fname = os.path.basename(ad.get('file', ''))
        active.append({
            'filename': fname,
            'slot': ad.get('slot', ''),
            'media_type': 'image' if fname.lower().rsplit('.', 1)[-1] in ('jpg', 'jpeg', 'png', 'gif', 'webp') else 'video',
            'duration_seconds': ad.get('duration_seconds', 10),
            'order': ad.get('order', 0),
        })
    return active


def post_heartbeat(api_url: str, device_id: str, zone: str, station: str,
                   active_ads: list, logger: logging.Logger):
    """POST playback snapshot to the server heartbeat endpoint. Non-fatal."""
    if not device_id:
        return
    url = f"{api_url.rstrip('/')}/api/devices/{device_id}/heartbeat/"
    payload = {
        'device_id': device_id,
        'zone': zone,
        'station': station,
        'timestamp': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S'),
        'active_ads': active_ads,
    }
    try:
        resp = requests.post(url, json=payload, timeout=10)
        resp.raise_for_status()
        logger.info(f"  Heartbeat sent — {len(active_ads)} active ad(s).")
    except Exception as exc:
        logger.warning(f"  Heartbeat failed (non-fatal): {exc}")


# ---------------------------------------------------------------------------
# File helpers
# ---------------------------------------------------------------------------

def filename_from_url(url: str) -> str:
    """Extract filename from a URL."""
    return os.path.basename(urlparse(url).path)


def file_needs_download(dest_path: Path, url: str) -> bool:
    """Return True if the file doesn't exist locally yet."""
    return not dest_path.exists()


def download_file(url: str, dest_path: Path, logger: logging.Logger) -> bool:
    """Stream-download a file from url to dest_path. Returns True on success."""
    try:
        with requests.get(url, stream=True, timeout=60) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("content-length", 0))
            downloaded = 0
            with open(dest_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=1024 * 256):
                    f.write(chunk)
                    downloaded += len(chunk)

            size_kb = downloaded // 1024
            logger.info(f"  Downloaded: {dest_path.name}  ({size_kb} KB)")
            return True
    except Exception as exc:
        logger.error(f"  Failed to download {url}: {exc}")
        if dest_path.exists():
            dest_path.unlink()  # remove partial file
        return False


# ---------------------------------------------------------------------------
# Station identity + publishing
# ---------------------------------------------------------------------------

def load_station_identity(yaml_path: str, cfg, logger):
    """Read this CCU's serial + zone from config.yaml (mqis.serial_number / mqis.Zone).
    Falls back to the [device] section of config.ini if the yaml is missing."""
    serial, zone = '', ''
    if yaml_path:
        try:
            import yaml
            data = yaml.safe_load(Path(yaml_path).read_text()) or {}
            mq = data.get('mqis', {}) or {}
            serial = str(mq.get('serial_number', '') or '').strip()
            zone = str(mq.get('Zone', '') or '').strip()
        except Exception as exc:
            logger.warning(f"Could not read {yaml_path} ({exc}); using config.ini [device] fallback.")
    if not serial:
        serial = cfg.get('device', 'device_id', fallback='')
    if not zone:
        zone = cfg.get('device', 'zone', fallback='')
    return serial, zone


# Player panels are positional: sorted image #0 -> top-left, #1 -> top-right,
# #2 -> bottom-left; video(s) -> bottom-right. We prefix published filenames so
# their sort order lands each ad in its assigned slot.
SLOT_INDEX = {'top_left': '0', 'top_right': '1', 'bottom_left': '2', 'bottom_right': '3'}


def publish_ads(matched, cache_folder: Path, publish_folder: Path, ad_list_path: Path, logger):
    """Copy the matched (live + this-station) ads from cache into the player folder,
    renamed by slot so the read-only player shows them in the right panel, prune the
    rest, and write the static `ad-images` list the player fetches."""
    publish_folder.mkdir(parents=True, exist_ok=True)

    desired = {}  # published_name -> source path in cache
    for ad in matched:
        src = cache_folder / ad['filename']
        if not src.exists():
            continue
        if ad['media_type'] == 'video':
            pubname = f"9_{ad['filename']}"            # bottom-right video panel
        else:
            idx = SLOT_INDEX.get(ad.get('slot', ''), '2')   # default unslotted image -> bottom-left
            pubname = f"{idx}_{ad['filename']}"
        desired[pubname] = src

    # Copy new/changed
    for name, src in desired.items():
        dst = publish_folder / name
        try:
            if not dst.exists() or dst.stat().st_size != src.stat().st_size:
                shutil.copy2(src, dst)
                logger.info(f"  Published: {name}")
        except Exception as exc:
            logger.warning(f"  Could not publish {name}: {exc}")

    # Prune anything not currently published (config.json now lives in the cache,
    # not the player folder, so it gets pruned here too).
    for existing in publish_folder.iterdir():
        if existing.is_file() and existing.name not in desired:
            logger.info(f"  Unpublished (stale): {existing.name}")
            try:
                existing.unlink()
            except Exception:
                pass

    published = sorted(desired.keys())
    try:
        ad_list_path.write_text(json.dumps({"images": published}), encoding='utf-8')
        logger.info(f"  Ad list written: {ad_list_path.name} ({len(published)} item(s))")
    except Exception as exc:
        logger.warning(f"  Could not write ad list {ad_list_path}: {exc}")
    return published


# ---------------------------------------------------------------------------
# Sync logic
# ---------------------------------------------------------------------------

def sync_once(api_url: str, cache_folder: Path, publish_folder: Path, ad_list_path: Path,
              logger: logging.Logger, serial: str = '', zone: str = ''):
    """One cycle: cache ALL active media, then publish only this station's live ads."""

    playlist = fetch_playlist(api_url, logger)
    if playlist is None:
        return  # server unreachable — keep existing files, retry later

    if not playlist:
        logger.info("Playlist is empty — no active media.")

    # 1) Download ALL active media into the cache (pre-position).
    expected_files = set()
    for item in playlist:
        url = item.get("url", "")
        if not url:
            continue
        fname = filename_from_url(url)
        expected_files.add(fname)
        dest = cache_folder / fname
        if file_needs_download(dest, url):
            logger.info(f"New file: {fname}  [{item.get('media_type', '?')}]")
            download_file(url, dest, logger)

    # Prune cache of media no longer active.
    for existing in cache_folder.iterdir():
        if existing.is_file() and existing.name not in expected_files and existing.name != 'config.json':
            logger.info(f"Removing stale cache file: {existing.name}")
            existing.unlink()

    fetch_and_save_config(api_url, cache_folder, logger)   # writes cache/config.json
    logger.info(f"Cache synced — {len(expected_files)} active file(s).")

    # 2) Match this station's live ads and publish them to the player folder.
    now_dt = datetime.now()
    config_json_path = cache_folder / "config.json"
    matched = build_active_ads(config_json_path, now_dt, zone, serial)
    published = publish_ads(matched, cache_folder, publish_folder, ad_list_path, logger)
    logger.info(f"Published {len(published)} ad(s) for {serial or '(no serial)'} / {zone or '(no zone)'}.")

    # 3) Heartbeat (drives playback logs).
    if serial:
        post_heartbeat(api_url, serial, zone, serial, matched, logger)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Ads media sync daemon")
    parser.add_argument(
        "--config",
        default=str(Path(__file__).parent / "config.ini"),
        help="Path to config.ini (default: same folder as this script)",
    )
    args = parser.parse_args()

    cfg = load_config(args.config)

    api_url       = cfg.get("server", "api_url", fallback="http://localhost:8000")
    publish_folder = Path(cfg.get("sync", "download_folder", fallback="/tmp/ads"))
    cache_folder  = Path(cfg.get("sync", "cache_folder",
                                 fallback=str(Path(__file__).parent / "cache")))
    interval      = cfg.getint("sync", "poll_interval_seconds", fallback=30)
    log_file      = cfg.get("logging", "log_file", fallback="")
    station_yaml  = cfg.get("device", "station_config", fallback="/home/sureshr/ccu/setup/config.yaml")

    logger = setup_logging(log_file)

    # The player fetches /ad-images → served as a static file in the www root,
    # which is two levels above the player folder (…/www/images/Ad → …/www/ad-images).
    ad_list_override = cfg.get("sync", "ad_list_path", fallback="")
    ad_list_path = Path(ad_list_override) if ad_list_override else (publish_folder.parent.parent / "ad-images")

    # Station identity from config.yaml (serial + zone), config.ini [device] as fallback.
    serial, zone = load_station_identity(station_yaml, cfg, logger)

    cache_folder.mkdir(parents=True, exist_ok=True)
    publish_folder.mkdir(parents=True, exist_ok=True)

    logger.info("=" * 60)
    logger.info("Ads Media Sync started")
    logger.info(f"  API URL        : {api_url}")
    logger.info(f"  Cache folder   : {cache_folder}")
    logger.info(f"  Publish folder : {publish_folder}")
    logger.info(f"  Ad list file   : {ad_list_path}")
    logger.info(f"  Poll interval  : {interval}s")
    logger.info(f"  Station serial : {serial or '(unset)'}")
    logger.info(f"  Zone           : {zone or '(unset)'}")
    logger.info("=" * 60)

    try:
        while True:
            logger.info("--- Syncing playlist ---")
            sync_once(api_url, cache_folder, publish_folder, ad_list_path, logger, serial, zone)
            logger.info(f"Next sync in {interval}s  (Ctrl+C to stop)\n")
            time.sleep(interval)
    except KeyboardInterrupt:
        logger.info("Sync stopped by user.")


if __name__ == "__main__":
    main()
