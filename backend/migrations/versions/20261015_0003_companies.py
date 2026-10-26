"""companies: organizations, and which company each person belongs to.

Supervisors must belong to a company; admins never do.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-15 16:25:15.920346

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('organizations',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('length(trim(name)) > 0', name='organizations_name_not_blank'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('organizations_name_unique', 'organizations', [sa.literal_column('lower(name)')], unique=True)
    op.add_column('users', sa.Column('organization_id', sa.UUID(), nullable=True))
    op.create_index('users_organization_idx', 'users', ['organization_id'], unique=False)
    op.create_foreign_key('users_organization_id_fkey', 'users', 'organizations', ['organization_id'], ['id'],
                          ondelete='RESTRICT')
    # Existing supervisors have no company yet: they must be given one before this rule applies.
    op.execute("UPDATE users SET is_active = false WHERE role = 'supervisor' AND organization_id IS NULL")
    op.create_check_constraint('users_admin_is_global', 'users', "role <> 'admin' OR organization_id IS NULL")
    op.create_check_constraint('users_supervisor_has_company', 'users',
                               "role <> 'supervisor' OR organization_id IS NOT NULL OR NOT is_active")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('users_supervisor_has_company', 'users', type_='check')
    op.drop_constraint('users_admin_is_global', 'users', type_='check')
    op.drop_constraint('users_organization_id_fkey', 'users', type_='foreignkey')
    op.drop_index('users_organization_idx', table_name='users')
    op.drop_column('users', 'organization_id')
    op.drop_index('organizations_name_unique', table_name='organizations')
    op.drop_table('organizations')
