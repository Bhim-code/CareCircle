"""initial schema: users, sign-in, care links, medicines, reminders,
documents, written records, photos, preferences, push tokens, access log.

Revision ID: 0001
Revises: 
Create Date: 2026-10-15 15:42:50.816856

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('users',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('password_hash', sa.Text(), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('timezone', sa.String(length=64), server_default='UTC', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("role IN ('patient', 'caregiver', 'admin', 'supervisor')", name='users_role_valid'),
    sa.CheckConstraint('email = lower(email)', name='users_email_lowercase'),
    sa.CheckConstraint('length(trim(name)) > 0', name='users_name_not_blank'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email', name='users_email_unique')
    )
    op.create_table('access_log',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('viewer_id', sa.UUID(), nullable=False),
    sa.Column('viewer_role', sa.String(length=20), nullable=False),
    sa.Column('patient_id', sa.UUID(), nullable=True),
    sa.Column('action', sa.String(length=60), nullable=False),
    sa.Column('outcome', sa.String(length=10), server_default='allowed', nullable=False),
    sa.Column('at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("outcome IN ('allowed', 'denied')", name='access_log_outcome_valid'),
    sa.ForeignKeyConstraint(['patient_id'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['viewer_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('access_log_patient_idx', 'access_log', ['patient_id', 'at'], unique=False)
    op.create_index('access_log_viewer_idx', 'access_log', ['viewer_id', 'at'], unique=False)
    op.create_table('auth_sessions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('family_id', sa.UUID(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('rotated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash')
    )
    op.create_index('auth_sessions_family_idx', 'auth_sessions', ['family_id'], unique=False)
    op.create_table('care_links',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('patient_id', sa.UUID(), nullable=False),
    sa.Column('caregiver_id', sa.UUID(), nullable=True),
    sa.Column('invited_email', sa.String(length=254), nullable=False),
    sa.Column('status', sa.String(length=10), server_default='pending', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('ended_by', sa.UUID(), nullable=True),
    sa.CheckConstraint("status = 'pending' OR caregiver_id IS NOT NULL OR ended_at IS NOT NULL", name='care_links_active_has_caregiver'),
    sa.CheckConstraint("status IN ('pending', 'active', 'ended')", name='care_links_status_valid'),
    sa.CheckConstraint('caregiver_id IS NULL OR caregiver_id <> patient_id', name='care_links_not_self'),
    sa.CheckConstraint('invited_email = lower(invited_email)', name='care_links_email_lowercase'),
    sa.ForeignKeyConstraint(['caregiver_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['ended_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['patient_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('care_links_caregiver_idx', 'care_links', ['caregiver_id'], unique=False)
    op.create_index('care_links_invited_email_idx', 'care_links', ['invited_email'], unique=False)
    op.create_index('care_links_one_open_per_pair', 'care_links', ['patient_id', 'invited_email'], unique=True, postgresql_where=sa.text("status IN ('pending', 'active')"))
    op.create_table('health_documents',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('patient_id', sa.UUID(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('category', sa.String(length=30), nullable=False),
    sa.Column('recorded_on', sa.Date(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("category IN ('prescription', 'lab_report', 'imaging', 'discharge_summary', 'other')", name='health_documents_category_valid'),
    sa.ForeignKeyConstraint(['patient_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('health_documents_patient_idx', 'health_documents', ['patient_id'], unique=False)
    op.create_table('medicines',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('patient_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('times', sa.ARRAY(sa.String(length=5)), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=False),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('cardinality(times) BETWEEN 1 AND 12', name='medicines_times_count'),
    sa.CheckConstraint('end_date IS NULL OR end_date >= start_date', name='medicines_dates_order'),
    sa.CheckConstraint('length(trim(name)) > 0', name='medicines_name_not_blank'),
    sa.ForeignKeyConstraint(['patient_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('medicines_patient_idx', 'medicines', ['patient_id'], unique=False)
    op.create_table('password_reset_tokens',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash')
    )
    op.create_table('push_tokens',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('token', sa.String(length=512), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token')
    )
    op.create_table('record_entries',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('patient_id', sa.UUID(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('client_name', sa.String(length=100), nullable=True),
    sa.Column('title', sa.String(length=100), nullable=False),
    sa.Column('notes', sa.String(length=2000), nullable=True),
    sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('witness_name', sa.String(length=100), nullable=True),
    sa.Column('location', sa.String(length=100), nullable=True),
    sa.Column('severity', sa.String(length=10), nullable=True),
    sa.Column('action_taken', sa.String(length=2000), nullable=True),
    sa.Column('mood', sa.String(length=15), nullable=True),
    sa.Column('medicine_name', sa.String(length=100), nullable=True),
    sa.Column('recorded_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('recorded_by', sa.UUID(), nullable=False),
    sa.Column('edited_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('edited_by', sa.UUID(), nullable=True),
    sa.Column('version', sa.Integer(), server_default=sa.text('1'), nullable=False),
    sa.CheckConstraint("kind IN ('medical', 'behavioural', 'incident', 'medication')", name='record_entries_kind_valid'),
    sa.CheckConstraint("medicine_name IS NULL OR kind = 'medication'", name='record_entries_medicine_kind'),
    sa.CheckConstraint("mood IS NULL OR kind = 'behavioural'", name='record_entries_mood_kind'),
    sa.CheckConstraint("mood IS NULL OR mood IN ('calm', 'happy', 'anxious', 'confused', 'agitated', 'withdrawn')", name='record_entries_mood_valid'),
    sa.CheckConstraint("severity IS NULL OR kind = 'incident'", name='record_entries_severity_kind'),
    sa.CheckConstraint("severity IS NULL OR severity IN ('minor', 'moderate', 'serious')", name='record_entries_severity_valid'),
    sa.ForeignKeyConstraint(['edited_by'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['patient_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['recorded_by'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('record_entries_author_idx', 'record_entries', ['recorded_by'], unique=False)
    op.create_index('record_entries_patient_time_idx', 'record_entries', ['patient_id', 'occurred_at'], unique=False)
    op.create_table('user_preferences',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('larger_text', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('reminder_notifications', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('missed_dose_email', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('missed_dose_call', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id')
    )
    op.create_table('entry_photos',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('uploaded_by', sa.UUID(), nullable=False),
    sa.Column('entry_id', sa.UUID(), nullable=True),
    sa.Column('content_type', sa.String(length=20), nullable=False),
    sa.Column('size_bytes', sa.Integer(), nullable=False),
    sa.Column('storage_key', sa.String(length=100), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("content_type IN ('image/jpeg', 'image/png')", name='entry_photos_type'),
    sa.CheckConstraint('size_bytes > 0 AND size_bytes <= 5242880', name='entry_photos_size'),
    sa.ForeignKeyConstraint(['entry_id'], ['record_entries.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['uploaded_by'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('entry_id', name='entry_photos_one_per_entry'),
    sa.UniqueConstraint('storage_key')
    )
    op.create_table('record_entry_history',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('entry_id', sa.UUID(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('replaced_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('replaced_by', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['entry_id'], ['record_entries.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['replaced_by'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('entry_id', 'version', name='record_entry_history_version')
    )
    op.create_table('reminders',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('patient_id', sa.UUID(), nullable=False),
    sa.Column('medicine_id', sa.UUID(), nullable=False),
    sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('acknowledged_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('due_notified_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['medicine_id'], ['medicines.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['patient_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('medicine_id', 'scheduled_at', name='reminders_once_per_time')
    )
    op.create_index('reminders_patient_time_idx', 'reminders', ['patient_id', 'scheduled_at'], unique=False)
    op.create_index('reminders_unconfirmed_idx', 'reminders', ['scheduled_at'], unique=False, postgresql_where=sa.text('acknowledged_at IS NULL'))
    op.create_table('alerts_sent',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('reminder_id', sa.UUID(), nullable=False),
    sa.Column('recipient_id', sa.UUID(), nullable=False),
    sa.Column('channel', sa.String(length=10), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('delivered', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.CheckConstraint("channel IN ('email', 'call', 'push')", name='alerts_sent_channel_valid'),
    sa.ForeignKeyConstraint(['recipient_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['reminder_id'], ['reminders.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('reminder_id', 'recipient_id', 'channel', name='alerts_sent_once')
    )
    # The access log is append-only: the database itself refuses edits and deletes.
    op.execute("""
        CREATE FUNCTION access_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'access_log is append-only';
        END;
        $$;
    """)
    op.execute("""
        CREATE TRIGGER access_log_no_update_or_delete
        BEFORE UPDATE OR DELETE ON access_log
        FOR EACH ROW EXECUTE FUNCTION access_log_append_only();
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP TRIGGER IF EXISTS access_log_no_update_or_delete ON access_log")
    op.execute("DROP FUNCTION IF EXISTS access_log_append_only()")
    op.drop_table('alerts_sent')
    op.drop_index('reminders_unconfirmed_idx', table_name='reminders', postgresql_where=sa.text('acknowledged_at IS NULL'))
    op.drop_index('reminders_patient_time_idx', table_name='reminders')
    op.drop_table('reminders')
    op.drop_table('record_entry_history')
    op.drop_table('entry_photos')
    op.drop_table('user_preferences')
    op.drop_index('record_entries_patient_time_idx', table_name='record_entries')
    op.drop_index('record_entries_author_idx', table_name='record_entries')
    op.drop_table('record_entries')
    op.drop_table('push_tokens')
    op.drop_table('password_reset_tokens')
    op.drop_index('medicines_patient_idx', table_name='medicines')
    op.drop_table('medicines')
    op.drop_index('health_documents_patient_idx', table_name='health_documents')
    op.drop_table('health_documents')
    op.drop_index('care_links_one_open_per_pair', table_name='care_links', postgresql_where=sa.text("status IN ('pending', 'active')"))
    op.drop_index('care_links_invited_email_idx', table_name='care_links')
    op.drop_index('care_links_caregiver_idx', table_name='care_links')
    op.drop_table('care_links')
    op.drop_index('auth_sessions_family_idx', table_name='auth_sessions')
    op.drop_table('auth_sessions')
    op.drop_index('access_log_viewer_idx', table_name='access_log')
    op.drop_index('access_log_patient_idx', table_name='access_log')
    op.drop_table('access_log')
    op.drop_table('users')
