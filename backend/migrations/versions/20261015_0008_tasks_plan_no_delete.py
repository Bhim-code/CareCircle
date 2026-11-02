"""tasks.plan: caregivers add and edit their own tasks but never remove them.

Revision ID: 0008
Revises: 0007
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE permissions SET description = 'Add care tasks for linked clients from the app (and edit own ones; only supervisors remove tasks)' WHERE code = 'tasks.plan'")


def downgrade() -> None:
    op.execute("UPDATE permissions SET description = 'Add care tasks for linked clients from the app (and change own ones)' WHERE code = 'tasks.plan'")
