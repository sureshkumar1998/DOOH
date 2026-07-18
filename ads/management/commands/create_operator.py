from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth.models import User, Group


class Command(BaseCommand):
    help = 'Create an operator (view-only) dashboard user'

    def add_arguments(self, parser):
        parser.add_argument('username')
        parser.add_argument('password')

    def handle(self, *args, **opts):
        if User.objects.filter(username=opts['username']).exists():
            raise CommandError('User already exists.')
        u = User.objects.create_user(opts['username'], password=opts['password'])
        grp, _ = Group.objects.get_or_create(name='operator')
        u.groups.add(grp)
        self.stdout.write(f"Operator '{u.username}' created.")
