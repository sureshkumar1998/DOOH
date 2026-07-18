"""Swap data from the SwapReport API — input for ad-impression estimates.

Mirrors devices_source: POST with the auto-minted Bearer token, paginate, normalize.
We only keep the fields the impression model needs (station, BP count, status).
"""

import logging
import threading
import time

from django.conf import settings

from .sn_auth import get_bearer_token

try:
    import requests as _requests
except ImportError:  # pragma: no cover
    _requests = None

logger = logging.getLogger(__name__)

_PAGE_SIZE = 1000
_CACHE_TTL_SECONDS = 60
_lock = threading.Lock()
_cache = {}  # key -> (fetched_at, swaps)


def _fetch_page(station_ids, start_ms, end_ms, page):
    token = get_bearer_token()
    if not token:
        raise RuntimeError("no Station API token available")
    resp = _requests.post(
        settings.SWAP_API_URL,
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        json={
            'stationSerialNumbers': list(station_ids),
            'startTime': int(start_ms),
            'endTime': int(end_ms),
            'pageNumber': page,
            'pageSize': _PAGE_SIZE,
            'filter': getattr(settings, 'SWAP_API_FILTER', 1),
        },
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json().get('result', {}) or {}


def get_swaps(station_ids, start_ms, end_ms):
    """Return normalized swaps for the given stations in [start_ms, end_ms].

    Each item: { 'station_id', 'no_of_bps' (int), 'status' (str) }.
    Returns [] on failure (no dummy data). Cached briefly per identical query.
    """
    if _requests is None or not station_ids:
        return []
    key = (tuple(sorted(station_ids)), int(start_ms), int(end_ms))
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < _CACHE_TTL_SECONDS:
            return hit[1]

    swaps = []
    try:
        page = 0
        while True:
            result = _fetch_page(station_ids, start_ms, end_ms, page)
            records = result.get('recordsList', []) or []
            for r in records:
                try:
                    bp = int(r.get('no_of_bps') or 0)
                except (TypeError, ValueError):
                    bp = 0
                swaps.append({
                    'station_id': r.get('station_id'),
                    'no_of_bps': bp,
                    'status': (r.get('status') or '').lower(),
                })
            total = int(result.get('totalCount') or 0)
            page += 1
            if len(swaps) >= total or not records:
                break
    except Exception as exc:
        logger.warning(f"SwapReport unavailable ({exc}); returning no swaps.")
        return []

    with _lock:
        _cache[key] = (time.monotonic(), swaps)
    return swaps


def dwell_for(no_of_bps):
    """Screen-exposure seconds for a swap, by battery-pack count."""
    return settings.DWELL_SECONDS_BY_BP.get(no_of_bps, settings.DWELL_SECONDS_DEFAULT)
