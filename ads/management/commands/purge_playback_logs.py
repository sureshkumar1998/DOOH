from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from ads.models import PlaybackSnapshot


class Command(BaseCommand):
    help = 'Delete PlaybackSnapshot rows older than 30 days'

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=30)
        deleted, _ = PlaybackSnapshot.objects.filter(last_seen_at__lt=cutoff).delete()
        self.stdout.write(f'Deleted {deleted} snapshots older than 30 days.')
