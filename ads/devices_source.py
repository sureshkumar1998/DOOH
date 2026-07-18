import logging
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from django.conf import settings

from .sn_auth import get_bearer_token

try:
    import requests as _requests
except ImportError:
    _requests = None

logger = logging.getLogger(__name__)

# The Station Alert Report feed reports `dateTime` in Indian Standard Time
# (it matches "now" in Asia/Kolkata, not UTC), so heartbeats are computed in IST.
_FEED_TZ = ZoneInfo('Asia/Kolkata')

# The upstream feed returns ~1900 stations and takes ~2s. Cache the normalized
# result briefly so the Monitor list auto-refresh and the detail-drawer lookup
# share a single upstream fetch (detail clicks become instant).
_CACHE_TTL_SECONDS = 15
_cache_lock = threading.Lock()
_cache = {'devices': None, 'fetched_at': 0.0}


def _fetch_from_api():
    """POST to the Station Alert Report API and return the list of station rows.

    The endpoint is POST-only and wraps the stations in a `result` array:
        { "statusCode": 200, "message": "Ok", "result": [ {...station...}, ... ] }
    """
    if _requests is None:
        raise RuntimeError("requests library not available")
    url = settings.STATION_DATA_API_URL
    token = get_bearer_token()
    if not token:
        raise RuntimeError("no Station API token available")
    resp = _requests.post(
        url,
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        },
        json={'filter': 0, 'zoneType': 0},
        timeout=30,
    )
    resp.raise_for_status()
    payload = resp.json()
    return payload.get('result', []) if isinstance(payload, dict) else payload


def _normalize(row):
    """Map one API station row to the normalized device dict the views/UI expect."""
    raw_dt = row.get('dateTime')
    heartbeat_seconds = None
    if raw_dt:
        try:
            dt = datetime.fromisoformat(raw_dt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=_FEED_TZ)
            now_ist = datetime.now(_FEED_TZ)
            heartbeat_seconds = (now_ist - dt).total_seconds()
        except Exception:
            heartbeat_seconds = None

    return {
        'device_id':          row.get('stationSerialNumber'),
        'station':            row.get('stationSerialNumber'),
        'zone':               row.get('zone'),
        'location':           row.get('serviceLocation'),
        'heartbeat_seconds':  heartbeat_seconds,
        'last_sync':          raw_dt,
        'internet':           row.get('iStatus') == 'Online',
        'version':            row.get('stationVersion'),
        'operational_status': row.get('fStatus'),
        'power':              row.get('power'),
        'current_ad':         None,
        'storage_used_pct':   None,
        'last_restart':       None,
    }


def get_devices(force_refresh=False):
    """Return the live fleet from the Station API (cached for a few seconds).
    On failure, return an empty list (no dummy/sample data) so the Monitor only
    ever shows real stations."""
    now = time.monotonic()
    with _cache_lock:
        if (not force_refresh and _cache['devices'] is not None
                and now - _cache['fetched_at'] < _CACHE_TTL_SECONDS):
            return _cache['devices']
    try:
        rows = _fetch_from_api()
        devices = [_normalize(r) for r in rows]
    except Exception as exc:
        logger.warning(f"Station API unavailable ({exc}); returning no devices.")
        return []
    with _cache_lock:
        _cache['devices'] = devices
        _cache['fetched_at'] = time.monotonic()
    return devices


def get_device(device_id):
    for d in get_devices():
        if str(d.get('device_id')) == str(device_id):
            return d
    return None


def derive_status(heartbeat_seconds):
    """Map seconds-since-last-heartbeat to a fleet status.

    online  -> within DEVICE_ONLINE_SECONDS  (default 30s)
    warning -> within DEVICE_WARNING_SECONDS (default 5 min)
    offline -> older than that, or never seen
    """
    online = getattr(settings, 'DEVICE_ONLINE_SECONDS', 30)
    warning = getattr(settings, 'DEVICE_WARNING_SECONDS', 300)
    if heartbeat_seconds is None:
        return 'offline'
    if heartbeat_seconds <= online:
        return 'online'
    if heartbeat_seconds <= warning:
        return 'warning'
    return 'offline'
