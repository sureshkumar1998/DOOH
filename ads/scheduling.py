from datetime import datetime, timezone as dt_timezone
from zoneinfo import ZoneInfo
from django.conf import settings

SCHEDULE_TZ = getattr(settings, 'SCHEDULE_TZ', 'Asia/Kolkata')


def now_local():
    """Return the current datetime in the configured schedule timezone (default: IST)."""
    return datetime.now(dt_timezone.utc).astimezone(ZoneInfo(SCHEDULE_TZ))
