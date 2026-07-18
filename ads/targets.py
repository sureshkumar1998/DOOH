"""Zone & station lists for ad targeting — derived live from the Station API.

Zones and stations come straight from the live device feed (via devices_source),
so the names match the API exactly (e.g. "Bengaluru", not "BLR") and any newly
added zone/station shows up automatically on the upload pages. No hardcoded list.

Shapes returned to the frontend:
  zones    -> [{ "id": "Bengaluru", "name": "Bengaluru" }, ...]
  stations -> [{ "id": "<serial>", "name": "<serial>", "location": "<serviceLocation>", "zone": "<zone>" }, ...]

Zone id == zone name (so an ad's zone target matches a device's `zone` directly).
Station id == name == station serial number (its identity from the API); the service
location is carried separately as a human-readable helper.
"""

from .devices_source import get_devices


def get_zones():
    zones = sorted({d.get('zone') for d in get_devices() if d.get('zone')})
    return [{'id': z, 'name': z} for z in zones]


def get_stations():
    by_id = {}
    for d in get_devices():
        sid = d.get('device_id') or d.get('station')
        if not sid:
            continue
        by_id[sid] = {
            'id': sid,
            'name': sid,                       # station identity (serial) = its name
            'location': d.get('location') or '',
            'zone': d.get('zone') or '',
        }
    return sorted(by_id.values(), key=lambda s: (s['zone'], s['location'], s['id']))


def _name_map(items):
    return {item['id']: item['name'] for item in items}


def zone_name(zone_id):
    # Zone id already equals its name; the lookup is identity but kept for safety.
    return _name_map(get_zones()).get(zone_id, zone_id)


def station_name(station_id):
    return _name_map(get_stations()).get(station_id, station_id)


def name_for(target_type, target_id):
    return station_name(target_id) if target_type == 'station' else zone_name(target_id)
