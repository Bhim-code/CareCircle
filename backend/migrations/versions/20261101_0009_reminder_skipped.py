"""Skipped doses: reminders.skipped_at, never together with acknowledged_at.

Revision ID: 0009
Revises: 0008
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reminders", sa.Column("skipped_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint("reminders_taken_or_skipped", "reminders",
                               "acknowledged_at IS NULL OR skipped_at IS NULL")


def downgrade() -> None:
    op.drop_constraint("reminders_taken_or_skipped", "reminders", type_="check")
    op.drop_column("reminders", "skipped_at")
