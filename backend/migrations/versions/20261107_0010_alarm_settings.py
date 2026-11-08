"""Alarm settings in user preferences: sound, vibration and snooze length.

Revision ID: 0010
Revises: 0009
"""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_preferences", sa.Column("alarm_sound", sa.Boolean(), nullable=False,
                                                server_default=sa.text("true")))
    op.add_column("user_preferences", sa.Column("alarm_vibration", sa.Boolean(), nullable=False,
                                                server_default=sa.text("true")))
    op.add_column("user_preferences", sa.Column("snooze_minutes", sa.SmallInteger(), nullable=False,
                                                server_default=sa.text("10")))
    op.create_check_constraint("user_preferences_snooze_minutes_check", "user_preferences",
                               "snooze_minutes IN (5, 10, 15)")


def downgrade() -> None:
    op.drop_constraint("user_preferences_snooze_minutes_check", "user_preferences", type_="check")
    op.drop_column("user_preferences", "snooze_minutes")
    op.drop_column("user_preferences", "alarm_vibration")
    op.drop_column("user_preferences", "alarm_sound")
