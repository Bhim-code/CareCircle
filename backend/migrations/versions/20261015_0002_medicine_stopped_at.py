"""medicine stopped_at: stopping a medicine keeps its history and ends future doses.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-15 16:08:54.484354

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0002'
down_revision: Union[str, Sequence[str], None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('medicines', sa.Column('stopped_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('medicines', 'stopped_at')
