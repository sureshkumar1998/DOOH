from django.db import migrations


def approve_existing_ads(apps, schema_editor):
    """Round 15 introduces an approval gate (AdMedia.status defaults to
    'pending'). Anything uploaded before this migration was already running
    live, so grandfather it in as 'approved' rather than yanking it from
    playback/config/sync until someone re-approves it."""
    AdMedia = apps.get_model('ads', 'AdMedia')
    AdMedia.objects.update(status='approved')


def reverse_noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('ads', '0009_advertiser_admedia_status_placement_end_date_and_more'),
    ]

    operations = [
        migrations.RunPython(approve_existing_ads, reverse_noop),
    ]
