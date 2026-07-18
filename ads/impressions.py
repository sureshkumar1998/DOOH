"""Ad-impression estimates from swap data (captive-screen model).

impressions(ad) = Σ over the ad's target stations [ total_dwell(station) / loop_length(station, slot) ]
  total_dwell(station) = Σ dwell(no_of_bps) over the station's swaps in the window
  loop_length(station, slot) = Σ duration_seconds of the active+live ads sharing that slot there

No DOOH visibility factor: swappers face the screen, so exposure is driven by real swaps.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings

from .models import AdMedia
from .scheduling import now_local
from .devices_source import get_devices
from .swap_source import get_swaps, dwell_for
from .targets import zone_name

_IST = ZoneInfo('Asia/Kolkata')


def _date_window_ms(date_from, date_to):
    """IST day range [from 00:00, to+1 00:00) → (start_ms, end_ms) epoch milliseconds."""
    start = datetime.strptime(date_from, '%Y-%m-%d').replace(tzinfo=_IST)
    end = datetime.strptime(date_to, '%Y-%m-%d').replace(tzinfo=_IST) + timedelta(days=1)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def _station_zone_map():
    return {d['device_id']: d.get('zone', '') for d in get_devices()}


def _ad_targets_station(ad, station_id, station_zone):
    if ad.target_type == 'station':
        return station_id in ad.targets
    return station_zone in {zone_name(t) for t in ad.targets}


def compute(date_from, date_to, station_ids):
    """Per-ad impressions over [date_from, date_to] (IST) for the given station set."""
    start_ms, end_ms = _date_window_ms(date_from, date_to)
    station_ids = list(station_ids)
    zone_of = _station_zone_map()

    # 1. Swaps → per-station dwell + counts.
    swaps = get_swaps(station_ids, start_ms, end_ms)
    count_failed = getattr(settings, 'IMPRESSIONS_COUNT_FAILED_SWAPS', True)
    dwell = {}        # station_id -> total dwell seconds
    swap_ct = {}      # station_id -> swap count
    for s in swaps:
        bp = s['no_of_bps']
        if bp < 1:
            continue
        if not count_failed and s['status'] != 'ok':
            continue
        sid = s['station_id']
        dwell[sid] = dwell.get(sid, 0) + dwell_for(bp)
        swap_ct[sid] = swap_ct.get(sid, 0) + 1

    # 2. Active+live ads and the per-(station,slot) loop length.
    now = now_local()
    ads = [a for a in AdMedia.objects.filter(is_active=True) if a.is_live(now)]
    loop_cache = {}   # (station_id, slot) -> total duration seconds

    def loop_length(station_id, slot, station_zone):
        key = (station_id, slot)
        if key in loop_cache:
            return loop_cache[key]
        total = sum(
            a.duration_seconds for a in ads
            if a.slot == slot and _ad_targets_station(a, station_id, station_zone)
        )
        loop_cache[key] = total
        return total

    # 3. Per-ad impressions across its matching stations.
    rows = []
    grand_impr = 0.0
    for ad in ads:
        impr = 0.0
        ad_swaps = 0
        ad_dwell = 0
        n_stations = 0
        for sid in station_ids:
            zone = zone_of.get(sid, '')
            if not _ad_targets_station(ad, sid, zone):
                continue
            station_dwell = dwell.get(sid, 0)
            if station_dwell == 0:
                continue
            ll = loop_length(sid, ad.slot, zone)
            if ll <= 0:
                continue
            impr += station_dwell / ll
            ad_swaps += swap_ct.get(sid, 0)
            ad_dwell += station_dwell
            n_stations += 1
        rows.append({
            'ad_id': ad.id,
            'title': ad.title,
            'media_type': ad.media_type,
            'slot': ad.slot,
            'duration_seconds': ad.duration_seconds,
            'stations': n_stations,
            'swaps': ad_swaps,
            'avg_dwell_sec': round(ad_dwell / ad_swaps, 1) if ad_swaps else 0,
            'impressions': round(impr, 1),
        })
        grand_impr += impr

    rows.sort(key=lambda r: r['impressions'], reverse=True)
    totals = {
        'swaps': sum(swap_ct.values()),
        'impressions': round(grand_impr, 1),
        'stations_with_swaps': len(swap_ct),
        'avg_dwell_sec': round(sum(dwell.values()) / sum(swap_ct.values()), 1) if swap_ct else 0,
    }
    return {'ads': rows, 'totals': totals}
