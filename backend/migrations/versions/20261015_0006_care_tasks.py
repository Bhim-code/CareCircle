"""care tasks: a care plan of daily tasks per client (care_tasks), what was done or
skipped each day plus extra work (task_completions), missed-task alerts sent once
(task_alerts), and the permissions tasks.manage / tasks.view / tasks.complete.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-15 17:55:15.170579

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0006'
down_revision: Union[str, Sequence[str], None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('care_tasks',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('patient_id', sa.UUID(), nullable=False),
    sa.Column('title', sa.String(length=100), nullable=False),
    sa.Column('instructions', sa.String(length=2000), nullable=True),
    sa.Column('time_of_day', sa.Time(), nullable=True),
    sa.Column('days', sa.ARRAY(sa.SmallInteger()), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=False),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.Column('grace_minutes', sa.Integer(), server_default=sa.text('60'), nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('replaced_by', sa.UUID(), nullable=True),
    sa.CheckConstraint('cardinality(days) BETWEEN 1 AND 7 AND days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]', name='care_tasks_days_valid'),
    sa.CheckConstraint('end_date IS NULL OR end_date >= start_date', name='care_tasks_dates_order'),
    sa.CheckConstraint('grace_minutes BETWEEN 0 AND 720', name='care_tasks_grace_valid'),
    sa.CheckConstraint('length(trim(title)) > 0', name='care_tasks_title_not_blank'),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['patient_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['replaced_by'], ['care_tasks.id'], name='care_tasks_replaced_by_fkey', ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('care_tasks_patient_idx', 'care_tasks', ['patient_id'], unique=False)
    op.create_table('task_alerts',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('task_id', sa.UUID(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('recipient_id', sa.UUID(), nullable=False),
    sa.Column('stage', sa.String(length=12), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("stage IN ('caregiver', 'supervisor')", name='task_alerts_stage_valid'),
    sa.ForeignKeyConstraint(['recipient_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['task_id'], ['care_tasks.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('task_id', 'day', 'recipient_id', 'stage', name='task_alerts_once')
    )
    op.create_table('task_completions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('patient_id', sa.UUID(), nullable=False),
    sa.Column('task_id', sa.UUID(), nullable=True),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('reason', sa.String(length=200), nullable=True),
    sa.Column('title', sa.String(length=100), nullable=True),
    sa.Column('note', sa.String(length=2000), nullable=True),
    sa.Column('done_by', sa.UUID(), nullable=False),
    sa.Column('done_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("status <> 'skipped' OR length(trim(coalesce(reason, ''))) > 0", name='task_completions_skip_has_reason'),
    sa.CheckConstraint("status IN ('done', 'skipped')", name='task_completions_status_valid'),
    sa.CheckConstraint("task_id IS NOT NULL OR (status = 'done' AND length(trim(coalesce(title, ''))) > 0)", name='task_completions_extra_has_title'),
    sa.ForeignKeyConstraint(['done_by'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['patient_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['task_id'], ['care_tasks.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('task_completions_once_per_day', 'task_completions', ['task_id', 'day'], unique=True, postgresql_where=sa.text('task_id IS NOT NULL'))
    op.create_index('task_completions_patient_day_idx', 'task_completions', ['patient_id', 'day'], unique=False)

    op.execute("""
        INSERT INTO permissions (code, description) VALUES
          ('tasks.manage', 'Plan clients'' daily care tasks'),
          ('tasks.view', 'See the care plan and what was done each day'),
          ('tasks.complete', 'Mark care tasks done or skipped, and log extra work')
    """)
    grants = {"tasks.manage": ("supervisor", "admin"),
              "tasks.view": ("patient", "caregiver", "supervisor", "admin"),
              "tasks.complete": ("caregiver", "supervisor", "admin")}
    for code, kinds in grants.items():
        op.execute(sa.text(
            "INSERT INTO role_permissions (role_id, permission_id) "
            "SELECT r.id, p.id FROM roles r, permissions p "
            "WHERE r.is_system AND r.kind = ANY(:kinds) AND p.code = :code"
        ).bindparams(kinds=list(kinds), code=code))


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM permissions WHERE code IN ('tasks.manage', 'tasks.view', 'tasks.complete')")
    op.drop_index('task_completions_patient_day_idx', table_name='task_completions')
    op.drop_index('task_completions_once_per_day', table_name='task_completions', postgresql_where=sa.text('task_id IS NOT NULL'))
    op.drop_table('task_completions')
    op.drop_table('task_alerts')
    op.drop_index('care_tasks_patient_idx', table_name='care_tasks')
    op.drop_table('care_tasks')
