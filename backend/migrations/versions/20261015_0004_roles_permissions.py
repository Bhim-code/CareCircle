"""roles and permissions: roles <-> permissions and users <-> permissions (many-to-many),
profiles, account change history, and "pending" for people waiting for a role.

The permission list and default roles are copied here as plain data (not imported
from app code) so this migration always does the same thing, even after the code
changes. Later permissions get their own migration.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-15 17:12:43.526852

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

PERMISSIONS = [{'id': 1, 'code': 'panel.access', 'description': 'Sign in to the admin panel'},
 {'id': 2, 'code': 'people.view', 'description': 'See the list of people and their profiles'},
 {'id': 3, 'code': 'people.create', 'description': 'Create accounts'},
 {'id': 4, 'code': 'people.edit', 'description': 'Edit profile details and photos'},
 {'id': 5, 'code': 'people.deactivate', 'description': 'Turn accounts off and on (delete = turn off)'},
 {'id': 6, 'code': 'roles.assign', 'description': "Change a person's role"},
 {'id': 7, 'code': 'permissions.grant', 'description': "Give or remove a person's extra permissions"},
 {'id': 8, 'code': 'roles.manage', 'description': 'Create roles and choose their permissions'},
 {'id': 9, 'code': 'records.view', 'description': "Open patients' records, reminders and documents"},
 {'id': 10, 'code': 'records.export', 'description': 'Export records and reminders to CSV'},
 {'id': 11, 'code': 'audit.view', 'description': 'See the access log'},
 {'id': 12, 'code': 'entries.write.medical', 'description': 'Write medical records'},
 {'id': 13, 'code': 'entries.write.behavioural', 'description': 'Write behavioural records'},
 {'id': 14, 'code': 'entries.write.incident', 'description': 'Write incident records'},
 {'id': 15, 'code': 'entries.write.medication', 'description': 'Write medication records'}]

DEFAULT_ROLES = [{'name': 'Patient',
  'kind': 'patient',
  'description': 'Receives care and medicine reminders',
  'permissions': ['entries.write.medical', 'entries.write.incident', 'entries.write.medication']},
 {'name': 'Caregiver',
  'kind': 'caregiver',
  'description': 'Looks after linked patients',
  'permissions': ['entries.write.behavioural', 'entries.write.incident', 'entries.write.medication']},
 {'name': 'Supervisor',
  'kind': 'supervisor',
  'description': 'Runs the care team in the admin panel',
  'permissions': ['panel.access',
                  'people.view',
                  'people.create',
                  'people.edit',
                  'people.deactivate',
                  'roles.assign',
                  'permissions.grant',
                  'roles.manage',
                  'records.view',
                  'records.export',
                  'audit.view']},
 {'name': 'Admin',
  'kind': 'admin',
  'description': 'Platform administrator (every permission)',
  'permissions': ['panel.access',
                  'people.view',
                  'people.create',
                  'people.edit',
                  'people.deactivate',
                  'roles.assign',
                  'permissions.grant',
                  'roles.manage',
                  'records.view',
                  'records.export',
                  'audit.view',
                  'entries.write.medical',
                  'entries.write.behavioural',
                  'entries.write.incident',
                  'entries.write.medication']}]

# revision identifiers, used by Alembic.
revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('permissions',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('code', sa.String(length=60), nullable=False),
    sa.Column('description', sa.String(length=200), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code')
    )
    op.create_table('roles',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=60), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('description', sa.String(length=200), server_default='', nullable=False),
    sa.Column('is_system', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("kind IN ('patient', 'caregiver', 'supervisor', 'admin')", name='roles_kind_valid'),
    sa.CheckConstraint('length(trim(name)) > 0', name='roles_name_not_blank'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('roles_name_unique', 'roles', [sa.literal_column('lower(name)')], unique=True)
    op.create_index('roles_one_system_role_per_kind', 'roles', ['kind'], unique=True, postgresql_where=sa.text('is_system'))
    op.create_table('role_permissions',
    sa.Column('role_id', sa.UUID(), nullable=False),
    sa.Column('permission_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['permission_id'], ['permissions.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('role_id', 'permission_id')
    )
    op.create_table('account_changes',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('changed_by', sa.UUID(), nullable=True),
    sa.Column('change', sa.String(length=30), nullable=False),
    sa.Column('before', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('after', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['changed_by'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('account_changes_user_idx', 'account_changes', ['user_id', 'at'], unique=False)
    op.create_table('user_permissions',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('permission_id', sa.Integer(), nullable=False),
    sa.Column('granted_by', sa.UUID(), nullable=True),
    sa.Column('granted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['granted_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['permission_id'], ['permissions.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'permission_id')
    )
    op.create_table('user_profiles',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('phone', sa.String(length=30), nullable=True),
    sa.Column('date_of_birth', sa.Date(), nullable=True),
    sa.Column('address', sa.String(length=300), nullable=True),
    sa.Column('emergency_contact_name', sa.String(length=100), nullable=True),
    sa.Column('emergency_contact_phone', sa.String(length=30), nullable=True),
    sa.Column('notes', sa.String(length=2000), nullable=True),
    sa.Column('photo_key', sa.String(length=100), nullable=True),
    sa.Column('photo_type', sa.String(length=20), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id'),
    sa.UniqueConstraint('photo_key')
    )
    op.add_column('users', sa.Column('role_id', sa.UUID(), nullable=True))
    op.add_column('users', sa.Column('requested_role', sa.String(length=20), nullable=True))
    op.create_index('users_role_id_idx', 'users', ['role_id'], unique=False)
    op.create_foreign_key('users_role_id_fkey', 'users', 'roles', ['role_id'], ['id'], ondelete='RESTRICT')

    # Data: the permission list, the four built-in roles, and which role has which permission.
    permissions = sa.table('permissions', sa.column('id', sa.Integer), sa.column('code', sa.String),
                           sa.column('description', sa.String))
    op.bulk_insert(permissions, PERMISSIONS)
    op.execute("SELECT setval(pg_get_serial_sequence('permissions', 'id'), (SELECT max(id) FROM permissions))")
    conn = op.get_bind()
    for role in DEFAULT_ROLES:
        role_id = conn.execute(sa.text(
            "INSERT INTO roles (name, kind, description, is_system) VALUES (:n, :k, :d, true) RETURNING id"),
            {"n": role["name"], "k": role["kind"], "d": role["description"]}).scalar()
        conn.execute(sa.text(
            "INSERT INTO role_permissions (role_id, permission_id) "
            "SELECT :r, id FROM permissions WHERE code = ANY(:codes)"),
            {"r": role_id, "codes": role["permissions"]})

    # Everyone who already has a role gets the built-in role of that kind.
    op.execute("UPDATE users u SET role_id = r.id FROM roles r WHERE r.is_system AND r.kind = u.role")

    # Rules: a fifth state "pending" (waiting for a role), which means no role_id.
    op.drop_constraint('users_role_valid', 'users', type_='check')
    op.create_check_constraint('users_role_valid', 'users',
                               "role IN ('patient', 'caregiver', 'admin', 'supervisor', 'pending')")
    op.create_check_constraint('users_pending_has_no_role', 'users', "(role = 'pending') = (role_id IS NULL)")
    op.create_check_constraint('users_requested_role_valid', 'users',
                               "requested_role IS NULL OR requested_role IN ('patient', 'caregiver')")

    # The change history can be added to, never edited or deleted.
    op.execute("""
        CREATE FUNCTION account_changes_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'account_changes is append-only';
        END;
        $$;
    """)
    op.execute("""
        CREATE TRIGGER account_changes_no_update_or_delete
        BEFORE UPDATE OR DELETE ON account_changes
        FOR EACH ROW EXECUTE FUNCTION account_changes_append_only();
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP TRIGGER IF EXISTS account_changes_no_update_or_delete ON account_changes")
    op.execute("DROP FUNCTION IF EXISTS account_changes_append_only()")
    op.drop_constraint('users_requested_role_valid', 'users', type_='check')
    op.drop_constraint('users_pending_has_no_role', 'users', type_='check')
    op.drop_constraint('users_role_valid', 'users', type_='check')
    # People still waiting for a role cannot exist in the older schema: they become patients.
    op.execute("UPDATE users SET role = 'patient' WHERE role = 'pending'")
    op.create_check_constraint('users_role_valid', 'users', "role IN ('patient', 'caregiver', 'admin', 'supervisor')")
    op.drop_constraint('users_role_id_fkey', 'users', type_='foreignkey')
    op.drop_index('users_role_id_idx', table_name='users')
    op.drop_column('users', 'requested_role')
    op.drop_column('users', 'role_id')
    op.drop_table('user_profiles')
    op.drop_table('user_permissions')
    op.drop_index('account_changes_user_idx', table_name='account_changes')
    op.drop_table('account_changes')
    op.drop_table('role_permissions')
    op.drop_index('roles_one_system_role_per_kind', table_name='roles', postgresql_where=sa.text('is_system'))
    op.drop_index('roles_name_unique', table_name='roles')
    op.drop_table('roles')
    op.drop_table('permissions')
