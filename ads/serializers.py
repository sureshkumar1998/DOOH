from rest_framework import serializers
from .models import AdMedia
from .scheduling import now_local


class AdMediaSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    schedule_status = serializers.SerializerMethodField()
    advertiser_name = serializers.SerializerMethodField()

    class Meta:
        model = AdMedia
        fields = [
            'id', 'title', 'media_type', 'url', 'duration_seconds', 'order',
            'is_active', 'uploaded_at', 'target_type', 'targets', 'slot',
            'start_date', 'end_date', 'daily_start_time', 'daily_end_time',
            'schedule_status', 'advertiser', 'advertiser_name', 'status',
        ]
        read_only_fields = ['id', 'uploaded_at', 'url', 'schedule_status', 'advertiser_name']

    def get_url(self, obj):
        request = self.context.get('request')
        if obj.file and request:
            return request.build_absolute_uri(obj.file.url)
        return None

    def get_schedule_status(self, obj):
        return obj.schedule_status(now_local())

    def get_advertiser_name(self, obj):
        return obj.advertiser.name if obj.advertiser_id else None


class AdMediaUploadSerializer(serializers.ModelSerializer):
    class Meta:
        model = AdMedia
        fields = ['id', 'title', 'file', 'duration_seconds', 'order', 'is_active']
        read_only_fields = ['id']
