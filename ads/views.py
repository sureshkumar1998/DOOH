import hashlib
import json
import magic
import os
import subprocess
import tempfile
from datetime import date as _date, time as _time, datetime as _datetime
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny, BasePermission
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.renderers import JSONRenderer, BrowsableAPIRenderer
from datetime import datetime, timedelta, timezone as _tz
from django.utils import timezone
from django.core.cache import cache
from django.http import HttpResponse
import csv
from .models import AdMedia, PlaybackSnapshot, DisplayConfig, Placement, Advertiser
from .serializers import AdMediaSerializer
from .targets import get_zones, get_stations, zone_name, station_name, name_for
from .devices_source import get_devices, get_device, derive_status
from .scheduling import now_local
from . import impressions as impressions_calc


def _role_of(user):
    return 'admin' if (user.is_superuser or user.is_staff) else 'operator'


class IsAdminRole(BasePermission):
    """Write access only for admin-role users (superuser/staff)."""
    message = 'Operator accounts are view-only.'

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and _role_of(request.user) == 'admin')


class MeView(APIView):
    """Returns the authenticated user's username and role (admin/operator)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({'username': request.user.username, 'role': _role_of(request.user)})


def _serialize_user(u):
    return {
        'id': u.id,
        'username': u.username,
        'role': _role_of(u),
        'is_active': u.is_active,
        'last_login': u.last_login.isoformat() if u.last_login else None,
        'date_joined': u.date_joined.isoformat() if u.date_joined else None,
    }


class UserListView(APIView):
    """Admin-only team management: list users, create a user with a role."""
    permission_classes = [IsAdminRole]

    def get(self, request):
        from django.contrib.auth.models import User
        return Response([_serialize_user(u) for u in User.objects.all().order_by('id')])

    def post(self, request):
        from django.contrib.auth.models import User
        username = (request.data.get('username') or '').strip()
        password = request.data.get('password') or ''
        role = request.data.get('role', 'operator')
        if not username:
            return Response({'error': 'Username is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(password) < 6:
            return Response({'error': 'Password must be at least 6 characters.'}, status=status.HTTP_400_BAD_REQUEST)
        if role not in ('admin', 'operator'):
            return Response({'error': "Role must be 'admin' or 'operator'."}, status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(username__iexact=username).exists():
            return Response({'error': 'A user with this username already exists.'}, status=status.HTTP_400_BAD_REQUEST)
        is_admin = role == 'admin'
        user = User.objects.create_user(
            username=username, password=password,
            is_staff=is_admin, is_superuser=is_admin, is_active=True,
        )
        return Response(_serialize_user(user), status=status.HTTP_201_CREATED)


class UserDetailView(APIView):
    """Admin-only: delete a user, or reset their password / role."""
    permission_classes = [IsAdminRole]

    def _get(self, pk):
        from django.contrib.auth.models import User
        try:
            return User.objects.get(pk=pk)
        except User.DoesNotExist:
            return None

    def patch(self, request, pk):
        from django.contrib.auth.models import User
        user = self._get(pk)
        if not user:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if 'password' in request.data:
            pw = request.data['password'] or ''
            if len(pw) < 6:
                return Response({'error': 'Password must be at least 6 characters.'}, status=status.HTTP_400_BAD_REQUEST)
            user.set_password(pw)
        if 'role' in request.data:
            role = request.data['role']
            if role not in ('admin', 'operator'):
                return Response({'error': "Role must be 'admin' or 'operator'."}, status=status.HTTP_400_BAD_REQUEST)
            # Don't let the last admin demote themselves out of admin.
            if role == 'operator' and user.id == request.user.id and User.objects.filter(is_superuser=True).count() <= 1:
                return Response({'error': 'You are the only admin — create another admin first.'}, status=status.HTTP_400_BAD_REQUEST)
            user.is_staff = user.is_superuser = (role == 'admin')
        if 'is_active' in request.data:
            user.is_active = bool(request.data['is_active'])
        user.save()
        return Response(_serialize_user(user))

    def delete(self, request, pk):
        from django.contrib.auth.models import User
        user = self._get(pk)
        if not user:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if user.id == request.user.id:
            return Response({'error': 'You cannot delete your own account.'}, status=status.HTTP_400_BAD_REQUEST)
        if _role_of(user) == 'admin' and User.objects.filter(is_superuser=True).count() <= 1:
            return Response({'error': 'Cannot delete the last admin account.'}, status=status.HTTP_400_BAD_REQUEST)
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _contract_status(advertiser):
    if not advertiser.contract_end:
        return 'none'
    today = now_local().date()
    if advertiser.contract_end < today:
        return 'expired'
    if advertiser.contract_end <= today + timedelta(days=14):
        return 'expiring_soon'
    return 'active'


def _serialize_advertiser(a):
    return {
        'id': a.id,
        'name': a.name,
        'contact_person': a.contact_person,
        'phone': a.phone,
        'email': a.email,
        'contract_start': a.contract_start.isoformat() if a.contract_start else None,
        'contract_end': a.contract_end.isoformat() if a.contract_end else None,
        'notes': a.notes,
        'ad_count': a.ads.count(),
        'placement_count': Placement.objects.filter(advertiser=a).count(),
        'contract_status': _contract_status(a),
    }


class AdvertiserListView(APIView):
    """List/create Advertisers (clients). GET is available to both roles so
    operators can see who a placement belongs to; POST is admin-only."""

    def get_permissions(self):
        return [IsAuthenticated()] if self.request.method == 'GET' else [IsAdminRole()]

    def get(self, request):
        advertisers = Advertiser.objects.all()
        return Response([_serialize_advertiser(a) for a in advertisers])

    def post(self, request):
        name = (request.data.get('name') or '').strip()
        if not name:
            return Response({'error': 'name is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if Advertiser.objects.filter(name__iexact=name).exists():
            return Response({'error': 'An advertiser with this name already exists.'}, status=status.HTTP_400_BAD_REQUEST)

        advertiser = Advertiser.objects.create(
            name=name,
            contact_person=request.data.get('contact_person', ''),
            phone=request.data.get('phone', ''),
            email=request.data.get('email', ''),
            contract_start=_parse_schedule_field('start_date', request.data.get('contract_start')),
            contract_end=_parse_schedule_field('end_date', request.data.get('contract_end')),
            notes=request.data.get('notes', ''),
        )
        return Response(_serialize_advertiser(advertiser), status=status.HTTP_201_CREATED)


class AdvertiserDetailView(APIView):
    """Update or delete a single Advertiser. Admin only. Deleting an advertiser
    leaves its ads/placements in place (FK is SET_NULL)."""
    permission_classes = [IsAdminRole]

    def get_object(self, pk):
        try:
            return Advertiser.objects.get(pk=pk)
        except Advertiser.DoesNotExist:
            return None

    def patch(self, request, pk):
        advertiser = self.get_object(pk)
        if not advertiser:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        if 'name' in request.data:
            name = (request.data['name'] or '').strip()
            if not name:
                return Response({'error': 'name is required.'}, status=status.HTTP_400_BAD_REQUEST)
            if Advertiser.objects.exclude(pk=pk).filter(name__iexact=name).exists():
                return Response({'error': 'An advertiser with this name already exists.'}, status=status.HTTP_400_BAD_REQUEST)
            advertiser.name = name

        for field in ('contact_person', 'phone', 'email', 'notes'):
            if field in request.data:
                setattr(advertiser, field, request.data[field])

        if 'contract_start' in request.data:
            advertiser.contract_start = _parse_schedule_field('start_date', request.data['contract_start'])
        if 'contract_end' in request.data:
            advertiser.contract_end = _parse_schedule_field('end_date', request.data['contract_end'])

        advertiser.save()
        return Response(_serialize_advertiser(advertiser))

    def delete(self, request, pk):
        advertiser = self.get_object(pk)
        if not advertiser:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        advertiser.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


ALLOWED_MIME_TYPES = {
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/quicktime',
}
IMAGE_MIME_TYPES = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
MAX_UPLOAD_SIZE = 200 * 1024 * 1024  # 200 MB

SCHEDULE_FIELDS = {'start_date', 'end_date', 'daily_start_time', 'daily_end_time'}
VALID_SLOTS = {'top_left', 'top_right', 'bottom_left', 'bottom_right'}

# Ad panels in the CCU player are fixed 512x192 (8:3). We reject off-spec uploads so
# they render full-bleed (no black bars / no crop). Higher-res 8:3 files are allowed.
AD_PANEL_W = 512
AD_PANEL_H = 192
AD_ASPECT = 8 / 3
AD_ASPECT_TOL = 0.02


def detect_media_type(mime):
    if mime in IMAGE_MIME_TYPES:
        return 'image'
    return 'video'


def get_media_dimensions(django_file):
    """Return (width, height) of an uploaded image/video via ffprobe, or None on failure.
    Resets the file pointer to 0 before returning so later reads (hash/save) still work."""
    tmp_path = None
    try:
        if hasattr(django_file, 'temporary_file_path'):
            path = django_file.temporary_file_path()
        else:
            with tempfile.NamedTemporaryFile(delete=False) as tmp:
                for chunk in django_file.chunks():
                    tmp.write(chunk)
                tmp_path = tmp.name
            path = tmp_path
        result = subprocess.run(
            ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
             '-show_entries', 'stream=width,height', '-of', 'json', path],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return None
        streams = json.loads(result.stdout).get('streams', [])
        if not streams:
            return None
        w, h = streams[0].get('width'), streams[0].get('height')
        if not w or not h:
            return None
        return int(w), int(h)
    except Exception:
        return None
    finally:
        django_file.seek(0)
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


def validate_dimensions(w, h):
    """Return (ok, message). Requires 8:3 aspect and at least 512x192."""
    if w < AD_PANEL_W or h < AD_PANEL_H:
        return False, f'Minimum size is {AD_PANEL_W}×{AD_PANEL_H}.'
    if abs(w / h - AD_ASPECT) > AD_ASPECT_TOL:
        return False, f'Must be 8:3 aspect (e.g. {AD_PANEL_W}×{AD_PANEL_H} or 1024×384).'
    return True, ''


def _parse_schedule_field(name, value):
    """Convert form values to proper Python date/time objects, or None if unset."""
    if value in (None, '', 'null'):
        return None
    if isinstance(value, str):
        try:
            if name in ('start_date', 'end_date'):
                return _datetime.strptime(value, '%Y-%m-%d').date()
            if name in ('daily_start_time', 'daily_end_time'):
                return _datetime.strptime(value[:5], '%H:%M').time()
        except ValueError:
            return None
    return value


class PlaylistView(APIView):
    """Public endpoint — returns only currently-live ads for CCU playback."""
    permission_classes = [AllowAny]

    def get(self, request):
        now = now_local()
        ads = AdMedia.objects.filter(is_active=True, status='approved').order_by('order', 'uploaded_at')
        live_ads = [ad for ad in ads if ad.is_live(now)]
        serializer = AdMediaSerializer(live_ads, many=True, context={'request': request})
        return Response(serializer.data)


class LoginAdsView(APIView):
    """Public endpoint — media dropped into the project's login_ad/ folder,
    played on the dashboard login page's showcase panel. Drop a video/image
    into that folder and it appears on next login-page load (no rebuild)."""
    permission_classes = [AllowAny]

    _VIDEO_EXT = {'.mp4', '.webm', '.mov'}
    _IMAGE_EXT = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}

    def get(self, request):
        from django.conf import settings as dj_settings
        folder = dj_settings.BASE_DIR / 'login_ad'
        items = []
        if folder.is_dir():
            for f in sorted(folder.iterdir()):
                if not f.is_file():
                    continue
                ext = f.suffix.lower()
                if ext in self._VIDEO_EXT:
                    media_type = 'video'
                elif ext in self._IMAGE_EXT:
                    media_type = 'image'
                else:
                    continue
                items.append({
                    'id': f.name,
                    'title': f.stem,
                    'media_type': media_type,
                    'url': f'/login-ad/{f.name}',
                    'duration_seconds': 8,
                })
        return Response(items)


class AdSyncView(APIView):
    """Public endpoint for sync.py — returns ALL active ads regardless of schedule.
    Files must be pre-positioned on the device before their schedule window opens.
    The CCU uses config.json (from AdConfigView) to decide what to play at runtime."""
    permission_classes = [AllowAny]

    def get(self, request):
        ads = AdMedia.objects.filter(is_active=True, status='approved').order_by('order', 'uploaded_at')
        serializer = AdMediaSerializer(ads, many=True, context={'request': request})
        return Response(serializer.data)


class AdConfigView(APIView):
    """Public endpoint — zone/station names + per-ad schedule for CCU local filtering.
    CCU downloads this alongside media and uses it to decide what is playing right now."""
    permission_classes = [AllowAny]

    def get(self, request):
        ads = AdMedia.objects.filter(is_active=True, status='approved').order_by('order', 'uploaded_at')
        zones, stations = set(), set()
        ad_schedules = []
        for ad in ads:
            if ad.target_type == 'station':
                stations.update(station_name(t) for t in ad.targets)
            else:
                zones.update(zone_name(t) for t in ad.targets)
            ad_schedules.append({
                'file': ad.file.name,
                'target_type': ad.target_type,
                'targets': [name_for(ad.target_type, t) for t in ad.targets],
                'slot': ad.slot,
                'start_date': str(ad.start_date) if ad.start_date else None,
                'end_date': str(ad.end_date) if ad.end_date else None,
                'daily_start_time': str(ad.daily_start_time)[:5] if ad.daily_start_time else None,
                'daily_end_time': str(ad.daily_end_time)[:5] if ad.daily_end_time else None,
            })
        placements = []
        for p in Placement.objects.all():
            p_ads = []
            for slot, ad_id in (p.assignments or {}).items():
                ad = AdMedia.objects.filter(pk=ad_id).first()
                if not ad or ad.status != 'approved':
                    continue
                p_ads.append({'file': ad.file.name, 'slot': slot})
            placements.append({
                'id': p.id,
                'layout': p.layout,
                'target_type': p.target_type,
                'targets': p.targets,
                'ads': p_ads,
            })

        return Response({
            'zones': sorted(zones),
            'stations': sorted(stations),
            'ads': ad_schedules,
            'layout': DisplayConfig.get_solo().layout,
            'placements': placements,
        })


class LayoutView(APIView):
    """Get or set the network's chosen screen layout (1-6)."""
    def get_permissions(self):
        # CCUs read it unauthenticated (alongside config.json); admins set it.
        return [AllowAny()] if self.request.method == 'GET' else [IsAdminRole()]

    def get(self, request):
        return Response({'layout': DisplayConfig.get_solo().layout})

    def put(self, request):
        try:
            layout = int(request.data.get('layout'))
        except (TypeError, ValueError):
            return Response({'error': 'layout must be an integer 1-6.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not 1 <= layout <= 6:
            return Response({'error': 'layout must be between 1 and 6.'},
                            status=status.HTTP_400_BAD_REQUEST)
        cfg = DisplayConfig.get_solo()
        cfg.layout = layout
        cfg.save()
        return Response({'layout': cfg.layout})


def _build_placement_ads(placement, request):
    """{slot: {id,title,url,media_type,duration_seconds}} for a placement's assignments,
    skipping slots whose ad id no longer exists."""
    out = {}
    _now = now_local()
    for slot, ad_id in (placement.assignments or {}).items():
        ad = AdMedia.objects.filter(pk=ad_id).first()
        if not ad:
            continue
        out[slot] = {
            'id': ad.id,
            'title': ad.title,
            'url': request.build_absolute_uri(ad.file.url) if ad.file else None,
            'media_type': ad.media_type,
            'duration_seconds': ad.duration_seconds,
            'advertiser_name': ad.advertiser.name if ad.advertiser_id else None,
            'is_live': ad.is_live(_now),
            'play_state': _ad_play_state(ad, _now),
            'contract_status': _contract_status(ad.advertiser) if ad.advertiser_id else 'none',
        }
    return out


def _ad_play_state(ad, now):
    """Why an ad is/ isn't playing right now: live | scheduled | expired | paused | out_of_hours."""
    if not ad.is_active:
        return 'paused'
    today = now.date()
    if ad.start_date and today < ad.start_date:
        return 'scheduled'
    if ad.end_date and today > ad.end_date:
        return 'expired'
    if ad.daily_start_time and ad.daily_end_time:
        t = now.time().replace(tzinfo=None)
        s, e = ad.daily_start_time, ad.daily_end_time
        in_window = (s <= t <= e) if s <= e else (t >= s or t <= e)
        if not in_window:
            return 'out_of_hours'
    return 'live'


def _placement_status(placement):
    today = now_local().date()
    if placement.start_date and today < placement.start_date:
        return 'scheduled'
    if placement.end_date and today > placement.end_date:
        return 'ended'
    return 'active'


def _serialize_placement(placement, request):
    ads = _build_placement_ads(placement, request)
    advertisers = sorted({a['advertiser_name'] for a in ads.values() if a.get('advertiser_name')})
    live_ads = sum(1 for a in ads.values() if a['is_live'])
    states = [a['play_state'] for a in ads.values()]
    if live_ads > 0:
        status_val = 'active'
    elif 'scheduled' in states:
        status_val = 'scheduled'    # nothing live yet, but a future ad is coming
    elif ads:
        status_val = 'ended'        # all expired/paused, nothing upcoming
    else:
        status_val = _placement_status(placement)
    return {
        'id': placement.id,
        'layout': placement.layout,
        'target_type': placement.target_type,
        'targets': placement.targets,
        'name': placement.name,
        'advertiser': placement.advertiser_id,
        'advertiser_name': placement.advertiser.name if placement.advertiser_id else None,
        'advertisers': advertisers,   # distinct client names across assigned ads (multi-chip)
        'start_date': placement.start_date.isoformat() if placement.start_date else None,
        'end_date': placement.end_date.isoformat() if placement.end_date else None,
        'status': status_val,
        'live_ads': live_ads,
        'total_ads': len(ads),
        'created_at': placement.created_at.isoformat(),
        'ads': ads,
    }


class PlacementListView(APIView):
    """List/create Placement records — the persisted result of the Placement wizard.
    POST dual-writes into AdMedia (slot/target_type/targets) and DisplayConfig.layout
    so the CCU-facing sync/config pipeline keeps working unchanged."""

    def get_permissions(self):
        return [IsAuthenticated()] if self.request.method == 'GET' else [IsAdminRole()]

    def get(self, request):
        placements = Placement.objects.all()
        return Response([_serialize_placement(p, request) for p in placements])

    def post(self, request):
        try:
            layout = int(request.data.get('layout'))
        except (TypeError, ValueError):
            return Response({'error': 'layout must be an integer 1-6.'}, status=status.HTTP_400_BAD_REQUEST)
        if not 1 <= layout <= 6:
            return Response({'error': 'layout must be between 1 and 6.'}, status=status.HTTP_400_BAD_REQUEST)

        target_type = request.data.get('target_type', 'zone')
        if target_type not in ('zone', 'station'):
            return Response({'error': "target_type must be 'zone' or 'station'."}, status=status.HTTP_400_BAD_REQUEST)

        targets = request.data.get('targets')
        if not isinstance(targets, list) or not targets:
            return Response({'error': 'targets must be a non-empty list.'}, status=status.HTTP_400_BAD_REQUEST)

        assignments = request.data.get('assignments')
        if not isinstance(assignments, dict) or not assignments:
            return Response({'error': 'assignments must be a non-empty object of slot -> ad id.'},
                            status=status.HTTP_400_BAD_REQUEST)
        for slot, ad_id in assignments.items():
            if slot not in VALID_SLOTS:
                return Response({'error': f'Invalid slot: {slot}.'}, status=status.HTTP_400_BAD_REQUEST)
            ad = AdMedia.objects.filter(pk=ad_id).first()
            if not ad:
                return Response({'error': f'Ad {ad_id} does not exist.'}, status=status.HTTP_400_BAD_REQUEST)
            if ad.status != 'approved':
                return Response(
                    {'error': f'"{ad.title}" is still pending approval and cannot be placed.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Placement identifies itself by where + how it displays — not by client names
        # (a placement is a screen arrangement; clients are attributes of its ads).
        name = (request.data.get('name') or '').strip()
        if not name:
            extra = f' +{len(targets) - 1}' if len(targets) > 1 else ''
            name = f'{targets[0]}{extra} · Layout {layout}'

        # Advertiser + campaign dates are DERIVED from the assigned ads — never taken
        # from the request body (single source of truth = the ad's own advertiser).
        assigned_ads = {slot: AdMedia.objects.get(pk=ad_id) for slot, ad_id in assignments.items()}
        distinct_advertisers = {a.advertiser_id for a in assigned_ads.values() if a.advertiser_id}
        if len(distinct_advertisers) == 1:
            advertiser = Advertiser.objects.get(pk=next(iter(distinct_advertisers)))
            start_date = advertiser.contract_start
            end_date = advertiser.contract_end
        else:
            advertiser = None          # mixed clients (or none) → no single campaign window
            start_date = None
            end_date = None

        placement = Placement.objects.create(
            layout=layout,
            target_type=target_type,
            targets=targets,
            assignments=assignments,
            name=name,
            advertiser=advertiser,
            start_date=start_date,
            end_date=end_date,
        )

        # Dual-write CCU-facing fields; each ad's window follows ITS OWN client's contract.
        for slot, ad in assigned_ads.items():
            ad.slot = slot
            ad.target_type = target_type
            ad.targets = targets
            ad.start_date = ad.advertiser.contract_start if ad.advertiser_id else None
            ad.end_date = ad.advertiser.contract_end if ad.advertiser_id else None
            ad.save()

        cfg = DisplayConfig.get_solo()
        cfg.layout = layout
        cfg.save()

        return Response(_serialize_placement(placement, request), status=status.HTTP_201_CREATED)


class PlacementDetailView(APIView):
    """Delete a Placement. Any AdMedia it assigned is either cleared or, if another
    surviving placement still uses it, re-pointed at that placement's slot/targets."""
    permission_classes = [IsAdminRole]

    def delete(self, request, pk):
        try:
            placement = Placement.objects.get(pk=pk)
        except Placement.DoesNotExist:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        ad_ids = list((placement.assignments or {}).values())
        placement.delete()

        surviving = list(Placement.objects.all())  # ordered -created_at
        for ad_id in ad_ids:
            try:
                ad = AdMedia.objects.get(pk=ad_id)
            except AdMedia.DoesNotExist:
                continue
            match = next(
                (p for p in surviving if ad_id in (p.assignments or {}).values()),
                None,
            )
            if match:
                slot = next(s for s, a in match.assignments.items() if a == ad_id)
                ad.slot = slot
                ad.target_type = match.target_type
                ad.targets = match.targets
                # Dates follow the ad's OWN client's contract, not the placement's.
                ad.start_date = ad.advertiser.contract_start if ad.advertiser_id else None
                ad.end_date = ad.advertiser.contract_end if ad.advertiser_id else None
                ad.save()
            else:
                ad.slot = ''
                ad.targets = []
                ad.start_date = None
                ad.end_date = None
                ad.save()

        return Response(status=status.HTTP_204_NO_CONTENT)


def _relative_age(seconds):
    """Human 'last seen' string from seconds, e.g. '5 sec ago' / '2 min ago' / '--'."""
    if seconds is None:
        return '--'
    if seconds < 60:
        return f'{int(seconds)} sec ago'
    if seconds < 3600:
        return f'{int(seconds // 60)} min ago'
    if seconds < 86400:
        return f'{int(seconds // 3600)} hr ago'
    return f'{int(seconds // 86400)} day ago'


class DeviceListView(APIView):
    """Fleet monitor — proxies the live-data device API (currently sample data).
    Returns summary counts + every device with a derived online/warning/offline status."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .models import AdMedia
        now = now_local()
        all_active = list(AdMedia.objects.filter(is_active=True))
        live_zone_names = set()
        scheduled_zone_names = set()
        for ad in all_active:
            if ad.target_type != 'zone':
                continue
            names = {zone_name(t) for t in ad.targets}
            if ad.is_live(now):
                live_zone_names.update(names)
            else:
                scheduled_zone_names.update(names)

        def _ads_status(device_zone):
            if device_zone in live_zone_names:
                return 'running'
            if device_zone in scheduled_zone_names:
                return 'scheduled'
            return 'no_ads'

        # Currently-running ads per station, from each device's latest heartbeat.
        current_ads_by_device = {}
        for s in PlaybackSnapshot.objects.order_by('device_id', '-last_seen_at'):
            if s.device_id not in current_ads_by_device:
                current_ads_by_device[s.device_id] = [
                    {'filename': a.get('filename'), 'slot': a.get('slot', '')}
                    for a in (s.active_ads or [])
                ]

        devices = []
        counts = {'online': 0, 'warning': 0, 'offline': 0}
        freshest = None
        for d in get_devices():
            hb = d.get('heartbeat_seconds')
            status_val = derive_status(hb)
            counts[status_val] += 1
            if hb is not None and (freshest is None or hb < freshest):
                freshest = hb
            devices.append({
                **d,
                'status': status_val,
                'heartbeat_label': _relative_age(hb),
                'ads_status': _ads_status(d.get('zone', '') or ''),
                'operational_status': d.get('operational_status'),
                'power': d.get('power'),
                'current_ads': current_ads_by_device.get(d.get('device_id'), []),
            })

        summary = {
            'total': len(devices),
            'online': counts['online'],
            'warning': counts['warning'],
            'offline': counts['offline'],
            'last_sync': _relative_age(freshest),
        }
        return Response({'summary': summary, 'devices': devices})


class DeviceDetailView(APIView):
    """Single device detail for the click-through panel on the Monitor page."""
    permission_classes = [IsAuthenticated]

    def get(self, request, device_id):
        d = get_device(device_id)
        if not d:
            return Response({'error': 'Device not found.'}, status=status.HTTP_404_NOT_FOUND)
        hb = d.get('heartbeat_seconds')
        snap = (PlaybackSnapshot.objects
                .filter(device_id=device_id).order_by('-last_seen_at').first())
        current_ads = [
            {'filename': a.get('filename'), 'slot': a.get('slot', '')}
            for a in (snap.active_ads if snap else [])
        ]
        return Response({**d, 'status': derive_status(hb),
                         'heartbeat_label': _relative_age(hb),
                         'current_ads': current_ads})


class TargetsView(APIView):
    """Returns available zones or stations. Auth required.
    Query param: ?type=zone|station"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        target_type = request.query_params.get('type', 'zone')
        if target_type == 'station':
            return Response(get_stations())
        return Response(get_zones())


class ImpressionsView(APIView):
    """Estimated ad impressions from swap data. Auth required.

    Query params (all optional):
      from, to  — ISO dates (default: last 7 days), inclusive, IST.
      zone      — limit to stations in this zone.
      station   — limit to a single station serial.
    Without zone/station, scopes to every station targeted by an active ad
    (so we only query SwapReport for stations that actually run ads)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = now_local().date()
        date_to = request.query_params.get('to') or today.isoformat()
        date_from = request.query_params.get('from') or (today - timedelta(days=6)).isoformat()
        zone = request.query_params.get('zone')
        station = request.query_params.get('station')

        devices = get_devices()
        if station:
            station_ids = [station]
        elif zone:
            station_ids = [d['device_id'] for d in devices if d.get('zone') == zone]
        else:
            # Only stations targeted by an active ad (zone target → its stations).
            now = now_local()
            active = [a for a in AdMedia.objects.filter(is_active=True) if a.is_live(now)]
            target_stations, target_zones = set(), set()
            for a in active:
                if a.target_type == 'station':
                    target_stations.update(a.targets)
                else:
                    target_zones.update(zone_name(t) for t in a.targets)
            station_ids = [
                d['device_id'] for d in devices
                if d['device_id'] in target_stations or d.get('zone') in target_zones
            ]

        result = impressions_calc.compute(date_from, date_to, station_ids)
        result['range'] = {'from': date_from, 'to': date_to,
                           'zone': zone or '', 'station': station or '',
                           'station_count': len(station_ids)}
        return Response(result)


class AdUploadView(APIView):
    """Upload a new image or video ad. Admin only."""
    permission_classes = [IsAdminRole]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        file = request.FILES.get('file')
        if not file:
            return Response({'error': 'No file provided.'}, status=status.HTTP_400_BAD_REQUEST)

        if file.size > MAX_UPLOAD_SIZE:
            return Response({'error': 'File exceeds 200MB limit.'}, status=status.HTTP_400_BAD_REQUEST)

        file_mime = magic.from_buffer(file.read(2048), mime=True)
        file.seek(0)

        if file_mime not in ALLOWED_MIME_TYPES:
            return Response(
                {'error': f'Unsupported file type: {file_mime}. Allowed: jpg, png, gif, webp, mp4, webm.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        media_type = detect_media_type(file_mime)

        # Enforce ad panel dimensions: 8:3 aspect, at least 512x192.
        dims = get_media_dimensions(file)
        if not dims:
            return Response(
                {'error': 'Could not read image/video dimensions. Please upload a valid media file.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        ok, msg = validate_dimensions(*dims)
        if not ok:
            return Response(
                {'error': f'{media_type.capitalize()} is {dims[0]}×{dims[1]}. {msg}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        title = request.data.get('title', os.path.splitext(file.name)[0])
        duration = int(request.data.get('duration_seconds', 10))
        order = int(request.data.get('order', 0))
        slot = request.data.get('slot', '')
        if slot and slot not in VALID_SLOTS:
            return Response({'error': 'Invalid slot.'}, status=status.HTTP_400_BAD_REQUEST)
        target_type = request.data.get('target_type', 'zone')
        raw_targets = request.data.get('targets', '[]')
        try:
            targets = json.loads(raw_targets) if isinstance(raw_targets, str) else list(raw_targets)
        except (json.JSONDecodeError, TypeError):
            targets = []

        # Schedule fields — all optional
        start_date = _parse_schedule_field('start_date', request.data.get('start_date'))
        end_date = _parse_schedule_field('end_date', request.data.get('end_date'))
        daily_start_time = _parse_schedule_field('daily_start_time', request.data.get('daily_start_time'))
        daily_end_time = _parse_schedule_field('daily_end_time', request.data.get('daily_end_time'))

        # Advertiser (client) tag — REQUIRED for new uploads (single source of truth).
        advertiser_id = request.data.get('advertiser')
        if advertiser_id in (None, ''):
            return Response({'error': 'Please select a client (advertiser) for this ad.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            advertiser = Advertiser.objects.get(pk=advertiser_id)
        except (Advertiser.DoesNotExist, ValueError, TypeError):
            return Response({'error': f'Advertiser {advertiser_id} does not exist.'}, status=status.HTTP_400_BAD_REQUEST)

        # Content hash for duplicate detection
        hasher = hashlib.sha256()
        for chunk in file.chunks():
            hasher.update(chunk)
        file.seek(0)
        file_hash = hasher.hexdigest()

        # Reject if same content already targets overlapping zone/station
        for existing in AdMedia.objects.filter(file_hash=file_hash, target_type=target_type):
            overlap = set(existing.targets) & set(targets)
            if overlap:
                names = ', '.join(name_for(target_type, t) for t in sorted(overlap))
                return Response(
                    {'error': f'This {media_type} already exists for {target_type}(s): {names}.'},
                    status=status.HTTP_409_CONFLICT,
                )

        ad = AdMedia.objects.create(
            title=title,
            file=file,
            media_type=media_type,
            duration_seconds=duration,
            order=order,
            is_active=True,
            target_type=target_type,
            targets=targets,
            slot=slot,
            file_hash=file_hash,
            start_date=start_date,
            end_date=end_date,
            daily_start_time=daily_start_time,
            daily_end_time=daily_end_time,
            advertiser=advertiser,
        )

        serializer = AdMediaSerializer(ad, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class AdListView(APIView):
    """List all ads for management — returns everything regardless of live state."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        ads = AdMedia.objects.all().order_by('order', 'uploaded_at')
        serializer = AdMediaSerializer(ads, many=True, context={'request': request})
        return Response(serializer.data)


class AdDetailView(APIView):
    """Update or delete a single ad. Admin only."""
    permission_classes = [IsAdminRole]

    def get_object(self, pk):
        try:
            return AdMedia.objects.get(pk=pk)
        except AdMedia.DoesNotExist:
            return None

    def patch(self, request, pk):
        ad = self.get_object(pk)
        if not ad:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        allowed_fields = {
            'title', 'duration_seconds', 'order', 'is_active',
            'target_type', 'targets', 'slot',
            'start_date', 'end_date', 'daily_start_time', 'daily_end_time',
            'advertiser', 'status',
        }
        if 'slot' in request.data:
            slot_val = request.data['slot']
            if slot_val and slot_val not in VALID_SLOTS:
                return Response({'error': 'Invalid slot.'}, status=status.HTTP_400_BAD_REQUEST)
        if 'status' in request.data:
            status_val = request.data['status']
            if status_val not in ('pending', 'approved'):
                return Response({'error': "status must be 'pending' or 'approved'."}, status=status.HTTP_400_BAD_REQUEST)
        if 'advertiser' in request.data:
            advertiser_val = request.data['advertiser']
            if advertiser_val not in (None, '') and not Advertiser.objects.filter(pk=advertiser_val).exists():
                return Response({'error': f'Advertiser {advertiser_val} does not exist.'}, status=status.HTTP_400_BAD_REQUEST)
        for field in allowed_fields:
            if field in request.data:
                val = request.data[field]
                if field in SCHEDULE_FIELDS:
                    val = _parse_schedule_field(field, val)
                if field == 'advertiser':
                    ad.advertiser_id = val if val not in (None, '') else None
                    continue
                setattr(ad, field, val)
        ad.save()

        serializer = AdMediaSerializer(ad, context={'request': request})
        return Response(serializer.data)

    def delete(self, request, pk):
        ad = self.get_object(pk)
        if not ad:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        if ad.file and os.path.isfile(ad.file.path):
            os.remove(ad.file.path)

        ad.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class BulkReorderView(APIView):
    """Update order for multiple ads at once. Admin only."""
    permission_classes = [IsAdminRole]

    def post(self, request):
        items = request.data
        if not isinstance(items, list):
            return Response({'error': 'Expected a list.'}, status=status.HTTP_400_BAD_REQUEST)

        for item in items:
            try:
                ad = AdMedia.objects.get(pk=item['id'])
                ad.order = item['order']
                ad.save(update_fields=['order'])
            except (AdMedia.DoesNotExist, KeyError):
                continue

        return Response({'status': 'reordered'})


def _sort_key(ad):
    return (ad.get('slot', ''), ad.get('order', 0), ad.get('filename', ''))


class PlaybackHeartbeatView(APIView):
    """Device heartbeat — unauthenticated POST from CCU sync agents."""
    permission_classes = [AllowAny]

    def post(self, request, device_id):
        data = request.data
        zone = data.get('zone', '')
        station = data.get('station', '')
        active_ads = data.get('active_ads', [])

        now = timezone.now()

        # Stable sort for comparison
        sorted_new = sorted(active_ads, key=_sort_key)

        last = PlaybackSnapshot.objects.filter(device_id=device_id).order_by('-last_seen_at').first()
        if last is not None:
            sorted_last = sorted(last.active_ads, key=_sort_key)
            if sorted_last == sorted_new:
                last.last_seen_at = now
                last.save(update_fields=['last_seen_at'])
            else:
                PlaybackSnapshot.objects.create(
                    device_id=device_id,
                    zone=zone,
                    station=station,
                    active_ads=active_ads,
                    started_at=now,
                    last_seen_at=now,
                )
        else:
            PlaybackSnapshot.objects.create(
                device_id=device_id,
                zone=zone,
                station=station,
                active_ads=active_ads,
                started_at=now,
                last_seen_at=now,
            )

        # Purge rows older than 30 days — at most once per day via cache
        cache_key = 'playback_purge_done'
        if not cache.get(cache_key):
            cutoff = now - timedelta(days=30)
            PlaybackSnapshot.objects.filter(last_seen_at__lt=cutoff).delete()
            cache.set(cache_key, True, timeout=86400)

        return Response({'status': 'ok'})


class PlaybackLogView(APIView):
    """Return playback snapshots filtered by date/device/zone/station/filename."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        now = timezone.now()
        default_from = now - timedelta(days=7)

        raw_from = request.query_params.get('from', '')
        raw_to = request.query_params.get('to', '')
        try:
            from_dt = datetime.strptime(raw_from, '%Y-%m-%d').replace(tzinfo=_tz.utc)
        except (ValueError, TypeError):
            from_dt = default_from
        try:
            to_dt = datetime.strptime(raw_to, '%Y-%m-%d').replace(tzinfo=_tz.utc)
            # Include the full end day
            to_dt = to_dt.replace(hour=23, minute=59, second=59)
        except (ValueError, TypeError):
            to_dt = now

        qs = PlaybackSnapshot.objects.filter(
            last_seen_at__gte=from_dt,
            started_at__lte=to_dt,
        )

        device_id_q = request.query_params.get('device_id', '')
        zone_q = request.query_params.get('zone', '')
        station_q = request.query_params.get('station', '')
        filename_q = request.query_params.get('filename', '')

        if device_id_q:
            qs = qs.filter(device_id__icontains=device_id_q)
        if zone_q:
            qs = qs.filter(zone__icontains=zone_q)
        if station_q:
            qs = qs.filter(station__icontains=station_q)

        results = list(qs.order_by('-last_seen_at'))

        # Python-level filename filter (JSON field substring)
        if filename_q:
            fn_lower = filename_q.lower()
            results = [
                r for r in results
                if any(fn_lower in (ad.get('filename', '') or '').lower() for ad in r.active_ads)
            ]

        out = []
        for snap in results:
            duration_minutes = (snap.last_seen_at - snap.started_at).total_seconds() / 60
            out.append({
                'id': snap.id,
                'device_id': snap.device_id,
                'zone': snap.zone,
                'station': snap.station,
                'active_ads': snap.active_ads,
                'started_at': snap.started_at.isoformat(),
                'last_seen_at': snap.last_seen_at.isoformat(),
                'duration_minutes': round(duration_minutes, 2),
            })
        return Response(out)


class PlaybackLogSummaryView(APIView):
    """Aggregate playback time per ad filename."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        now = timezone.now()
        default_from = now - timedelta(days=7)

        raw_from = request.query_params.get('from', '')
        raw_to = request.query_params.get('to', '')
        try:
            from_dt = datetime.strptime(raw_from, '%Y-%m-%d').replace(tzinfo=_tz.utc)
        except (ValueError, TypeError):
            from_dt = default_from
        try:
            to_dt = datetime.strptime(raw_to, '%Y-%m-%d').replace(tzinfo=_tz.utc)
            to_dt = to_dt.replace(hour=23, minute=59, second=59)
        except (ValueError, TypeError):
            to_dt = now

        qs = PlaybackSnapshot.objects.filter(
            last_seen_at__gte=from_dt,
            started_at__lte=to_dt,
        )

        zone_q = request.query_params.get('zone', '')
        station_q = request.query_params.get('station', '')
        if zone_q:
            qs = qs.filter(zone__icontains=zone_q)
        if station_q:
            qs = qs.filter(station__icontains=station_q)

        # Per-filename aggregation
        agg = {}  # filename -> {slot, device_ids, total_minutes, zones}
        for snap in qs:
            duration_minutes = (snap.last_seen_at - snap.started_at).total_seconds() / 60
            for ad in snap.active_ads:
                fname = ad.get('filename', '')
                if not fname:
                    continue
                key = fname
                if key not in agg:
                    agg[key] = {
                        'filename': fname,
                        'slot': ad.get('slot', ''),
                        'device_ids': set(),
                        'total_minutes': 0.0,
                        'zones': set(),
                    }
                agg[key]['device_ids'].add(snap.device_id)
                agg[key]['total_minutes'] += duration_minutes
                if snap.zone:
                    agg[key]['zones'].add(snap.zone)

        result = sorted(
            [
                {
                    'filename': v['filename'],
                    'slot': v['slot'],
                    'device_count': len(v['device_ids']),
                    'total_device_minutes': round(v['total_minutes'], 2),
                    'running_minutes': round(v['total_minutes'], 1),
                    'zones': sorted(v['zones']),
                }
                for v in agg.values()
            ],
            key=lambda x: x['total_device_minutes'],
            reverse=True,
        )
        return Response(result)


def _hhmm(minutes):
    total = int(round(minutes))
    h, m = divmod(total, 60)
    return f'{h}h {m}m'


class _CSVFormatRenderer(JSONRenderer):
    """Registers format='csv' so DRF's content negotiation (?format=csv) doesn't
    404 before our view runs. We never actually use this renderer's .render() —
    the view returns a plain HttpResponse for format=csv, which bypasses it."""
    media_type = 'text/csv'
    format = 'csv'


class ProofOfPlayReportView(APIView):
    """Proof-of-play report — aggregates PlaybackSnapshot rows per ad file into a
    downloadable summary (JSON or CSV). No impressions/billing data — purely
    what actually played, where, and for how long, straight from device heartbeats."""
    permission_classes = [IsAuthenticated]
    renderer_classes = [JSONRenderer, BrowsableAPIRenderer, _CSVFormatRenderer]

    def get(self, request):
        now = timezone.now()
        default_from = now - timedelta(days=7)

        raw_from = request.query_params.get('from', '')
        raw_to = request.query_params.get('to', '')
        try:
            from_dt = datetime.strptime(raw_from, '%Y-%m-%d').replace(tzinfo=_tz.utc)
        except (ValueError, TypeError):
            from_dt = default_from
        try:
            to_dt = datetime.strptime(raw_to, '%Y-%m-%d').replace(tzinfo=_tz.utc)
            to_dt = to_dt.replace(hour=23, minute=59, second=59)
        except (ValueError, TypeError):
            to_dt = now

        from_str = raw_from or from_dt.date().isoformat()
        to_str = raw_to or to_dt.date().isoformat()

        qs = PlaybackSnapshot.objects.filter(
            last_seen_at__gte=from_dt,
            started_at__lte=to_dt,
        )

        zone_q = request.query_params.get('zone', '')
        if zone_q:
            qs = qs.filter(zone__icontains=zone_q)

        advertiser_q = request.query_params.get('advertiser', '')

        # Per-filename aggregation
        agg = {}  # filename -> {slot, device_ids, zones, total_minutes, first_seen, last_seen}
        for snap in qs:
            duration_minutes = (snap.last_seen_at - snap.started_at).total_seconds() / 60
            for ad in snap.active_ads:
                fname = ad.get('filename', '')
                if not fname:
                    continue
                if fname not in agg:
                    agg[fname] = {
                        'filename': fname,
                        'slot': ad.get('slot', ''),
                        'device_ids': set(),
                        'zones': set(),
                        'total_minutes': 0.0,
                        'first_seen': snap.started_at,
                        'last_seen': snap.last_seen_at,
                    }
                entry = agg[fname]
                entry['device_ids'].add(snap.device_id)
                entry['total_minutes'] += duration_minutes
                if snap.zone:
                    entry['zones'].add(snap.zone)
                if snap.started_at < entry['first_seen']:
                    entry['first_seen'] = snap.started_at
                if snap.last_seen_at > entry['last_seen']:
                    entry['last_seen'] = snap.last_seen_at

        # Resolve a nicer title/media_type by matching AdMedia's file basename.
        media_by_basename = {}
        for ad in AdMedia.objects.all():
            if ad.file:
                media_by_basename[os.path.basename(ad.file.name)] = ad

        # Most recent placement (campaign) per ad id — Placement is ordered -created_at,
        # so the first hit for a given ad id is its most recent campaign.
        campaign_by_ad_id = {}
        for p in Placement.objects.all():
            for ad_id in (p.assignments or {}).values():
                if ad_id not in campaign_by_ad_id:
                    campaign_by_ad_id[ad_id] = p.name or f'Layout {p.layout}'

        rows = []
        for v in agg.values():
            media = media_by_basename.get(os.path.basename(v['filename']))
            if advertiser_q:
                if not media or str(media.advertiser_id or '') != str(advertiser_q):
                    continue
            rows.append({
                'ad': media.title if media else (v['filename'] or '-'),
                'file': v['filename'],
                'media_type': media.media_type if media else '-',
                'slot': v['slot'],
                'zones': sorted(v['zones']),
                'station_count': len(v['device_ids']),
                'running_minutes': round(v['total_minutes'], 1),
                'running_hhmm': _hhmm(v['total_minutes']),
                'first_seen': v['first_seen'].isoformat(),
                'last_seen': v['last_seen'].isoformat(),
                'advertiser': media.advertiser.name if (media and media.advertiser_id) else '',
                'campaign': campaign_by_ad_id.get(media.id, '') if media else '',
            })

        rows.sort(key=lambda r: r['running_minutes'], reverse=True)

        fmt = request.query_params.get('format', '')
        if fmt == 'csv':
            response = HttpResponse(content_type='text/csv')
            response['Content-Disposition'] = (
                f'attachment; filename=proof_of_play_{from_str}_{to_str}.csv'
            )
            writer = csv.writer(response)
            writer.writerow(['Report: Proof of Play'])
            writer.writerow([f'Period: {from_str} → {to_str}'])
            writer.writerow([f'Zone: {zone_q or "All"}'])
            writer.writerow([f'Generated: {now.isoformat()}'])
            writer.writerow([])
            writer.writerow([
                'Ad', 'File', 'Type', 'Slot', 'Zones', 'Stations',
                'Running time (min)', 'Running time', 'First seen', 'Last seen',
                'Advertiser', 'Campaign',
            ])
            for r in rows:
                writer.writerow([
                    r['ad'], r['file'], r['media_type'], r['slot'],
                    ', '.join(r['zones']), r['station_count'],
                    r['running_minutes'], r['running_hhmm'],
                    r['first_seen'], r['last_seen'],
                    r['advertiser'], r['campaign'],
                ])
            return response

        return Response({
            'generated_at': now.isoformat(),
            'period_from': from_str,
            'period_to': to_str,
            'zone_filter': zone_q or '',
            'advertiser_filter': advertiser_q or '',
            'rows': rows,
        })
