from datetime import date as _date, time as _time, datetime as _datetime
from django.db import models


def _coerce_date(v):
    if v is None or isinstance(v, _date):
        return v
    return _datetime.strptime(str(v), '%Y-%m-%d').date()


def _coerce_time(v):
    if v is None or isinstance(v, _time):
        return v
    return _datetime.strptime(str(v)[:5], '%H:%M').time()


class Advertiser(models.Model):
    """A client/brand whose ads run on the network. Ads and Placements can be
    tagged to an Advertiser for campaign tracking and reporting; deleting an
    Advertiser leaves its ads/placements in place (SET_NULL)."""
    name           = models.CharField(max_length=200, unique=True)
    contact_person = models.CharField(max_length=200, blank=True)
    phone          = models.CharField(max_length=40, blank=True)
    email          = models.EmailField(blank=True)
    contract_start = models.DateField(null=True, blank=True)
    contract_end   = models.DateField(null=True, blank=True)
    notes          = models.TextField(blank=True)
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class AdMedia(models.Model):
    MEDIA_TYPE_CHOICES = [
        ('image', 'Image'),
        ('video', 'Video'),
    ]

    TARGET_TYPE_CHOICES = [
        ('zone', 'Zone'),
        ('station', 'Station'),
    ]

    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
    ]

    title = models.CharField(max_length=255)
    file = models.FileField(upload_to='ads/')
    media_type = models.CharField(max_length=10, choices=MEDIA_TYPE_CHOICES)
    duration_seconds = models.PositiveIntegerField(default=10, help_text="Display duration in seconds (images only)")
    order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    SLOT_CHOICES = [
        ('top_left', 'Top Left'), ('top_right', 'Top Right'),
        ('bottom_left', 'Bottom Left'), ('bottom_right', 'Bottom Right'),
    ]

    target_type = models.CharField(max_length=10, choices=TARGET_TYPE_CHOICES, default='zone')
    targets = models.JSONField(default=list, blank=True)
    slot = models.CharField(max_length=12, choices=SLOT_CHOICES, blank=True, default='')
    file_hash = models.CharField(max_length=64, blank=True, db_index=True)
    advertiser = models.ForeignKey(Advertiser, null=True, blank=True, on_delete=models.SET_NULL, related_name='ads')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='pending')

    # Scheduling fields — all optional; when unset the ad is always on
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    daily_start_time = models.TimeField(null=True, blank=True)
    daily_end_time = models.TimeField(null=True, blank=True)

    class Meta:
        ordering = ['order', 'uploaded_at']

    def __str__(self):
        return f"{self.title} ({self.media_type})"

    def is_live(self, now):
        """Return True if this ad should appear in the public playlist at `now` (IST-aware datetime)."""
        if not self.is_active:
            return False
        today = now.date()
        start_date = _coerce_date(self.start_date)
        end_date = _coerce_date(self.end_date)
        daily_start = _coerce_time(self.daily_start_time)
        daily_end = _coerce_time(self.daily_end_time)
        if start_date and today < start_date:
            return False
        if end_date and today > end_date:
            return False
        if daily_start and daily_end:
            t = now.time().replace(tzinfo=None)
            s = daily_start
            e = daily_end
            if s <= e:
                # Normal window e.g. 08:00–10:00
                if not (s <= t <= e):
                    return False
            else:
                # Overnight window e.g. 22:00–02:00
                if not (t >= s or t <= e):
                    return False
        return True

    def schedule_status(self, now):
        """Return a display status string for the management dashboard."""
        if not self.is_active:
            return 'paused'
        today = now.date()
        start_date = _coerce_date(self.start_date)
        end_date = _coerce_date(self.end_date)
        daily_start = _coerce_time(self.daily_start_time)
        daily_end = _coerce_time(self.daily_end_time)
        if start_date and today < start_date:
            return 'scheduled'
        if end_date and today > end_date:
            return 'expired'
        # Date range is current — check daily window
        if daily_start and daily_end:
            t = now.time().replace(tzinfo=None)
            s = daily_start
            e = daily_end
            in_window = (s <= t <= e) if s <= e else (t >= s or t <= e)
            return 'live' if in_window else 'scheduled'
        # No constraints at all or only date range which is current
        if start_date or end_date or daily_start or daily_end:
            return 'live'
        return 'always_on'


class PlaybackSnapshot(models.Model):
    device_id    = models.CharField(max_length=64, db_index=True)
    zone         = models.CharField(max_length=64, blank=True)
    station      = models.CharField(max_length=64, blank=True)
    active_ads   = models.JSONField()
    started_at   = models.DateTimeField()
    last_seen_at = models.DateTimeField()

    class Meta:
        indexes = [models.Index(fields=['device_id', 'last_seen_at'])]


class Placement(models.Model):
    """A saved wizard result: one screen layout + ad assignments applied to a
    set of zones or stations. Distinct from AdMedia.slot/targets (which the CCU
    sync/config pipeline actually reads) — this is the management-side record
    that lets the dashboard list/preview/remove what's been placed, and it
    dual-writes into AdMedia on save/delete so the CCU-facing fields stay in sync."""
    layout      = models.PositiveSmallIntegerField()
    target_type = models.CharField(max_length=10, default='zone')
    targets     = models.JSONField(default=list)     # zone names or station serials
    assignments = models.JSONField(default=dict)     # {slot: ad_id}
    name        = models.CharField(max_length=200, blank=True, default='')
    advertiser  = models.ForeignKey(Advertiser, null=True, blank=True, on_delete=models.SET_NULL)
    start_date  = models.DateField(null=True, blank=True)
    end_date    = models.DateField(null=True, blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']


class DisplayConfig(models.Model):
    """Singleton holding the network's chosen screen layout (1-6). Emitted into
    config.json as `layout` so the CCU display logic can apply it later."""
    layout = models.PositiveSmallIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)
