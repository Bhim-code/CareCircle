"""tasks.plan permission: lets a supervisor allow a caregiver (or a whole role) to add
care tasks for their linked clients from the app. Not given to any role by default.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-15 18:20:00

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0007'
down_revision: Union[str, Sequence[str], None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("""
        INSERT INTO permissions (code, description) VALUES
          ('tasks.plan', 'Add care tasks for linked clients from the app (and change own ones)')
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM permissions WHERE code = 'tasks.plan'")
