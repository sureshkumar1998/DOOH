"""Self-contained Station API auth.

Mints and caches an Azure AD Bearer token via the OAuth2 client-credentials flow,
mirroring the cache + refresh-before-expiry + retry behavior of the CCU's
SnApiManager.getBearerToken — but without any CCU-folder or device-identity
dependency. The resulting token's audience (api://6cf68dd7...) is what the
StationAlert API validates.

Credentials/URL come from settings (copied from station_api_configurations.json).
"""

import logging
import threading
import time

from django.conf import settings

try:
    import requests as _requests
except ImportError:  # pragma: no cover
    _requests = None

logger = logging.getLogger(__name__)

# Refresh this many seconds before the token actually expires (matches getBearerToken).
_EXPIRY_SKEW = 60
_MAX_RETRIES = 3
_RETRY_DELAY = 1

_lock = threading.Lock()
_cache = {'token': None, 'expiry': 0.0}  # expiry is epoch seconds


def _mint():
    """POST client-credentials and return (access_token, expiry_epoch) or (None, 0)."""
    if _requests is None:
        logger.warning("requests library not available; cannot mint Station token.")
        return None, 0
    payload = {
        'grant_type': 'client_credentials',
        'client_id': settings.STATION_AUTH_CLIENT_ID,
        'client_secret': settings.STATION_AUTH_CLIENT_SECRET,
        'scope': settings.STATION_AUTH_SCOPE,
        'resource': settings.STATION_AUTH_RESOURCE,
    }
    resp = _requests.post(
        settings.STATION_AUTH_URL,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
        data=payload,
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get('access_token')
    if not token:
        raise ValueError(f"token endpoint returned no access_token: {data.get('error')}")
    # Azure v1 returns expires_on (absolute epoch) and expires_in (seconds).
    if data.get('expires_on'):
        expiry = int(data['expires_on'])
    else:
        expiry = time.time() + int(data.get('expires_in', 3600))
    return token, expiry


def get_bearer_token(force=False):
    """Return a valid Bearer token, minting/refreshing as needed.

    Falls back to settings.STATION_DATA_API_TOKEN (manual emergency override) if
    minting fails. Returns None if no token can be obtained.
    """
    now = time.time()
    with _lock:
        if not force and _cache['token'] and now < _cache['expiry'] - _EXPIRY_SKEW:
            return _cache['token']

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            token, expiry = _mint()
            if token:
                with _lock:
                    _cache['token'] = token
                    _cache['expiry'] = expiry
                logger.info(f"Station token minted (attempt {attempt}); expires at {int(expiry)}.")
                return token
        except Exception as exc:
            logger.warning(f"Station token mint attempt {attempt} failed: {exc}")
        time.sleep(_RETRY_DELAY)

    # Minting failed — fall back to a manually supplied token if one is set.
    manual = getattr(settings, 'STATION_DATA_API_TOKEN', '')
    if manual:
        logger.warning("Using manual STATION_DATA_API_TOKEN override (mint failed).")
        return manual
    logger.error("Could not obtain a Station API token (mint failed, no override).")
    return None
