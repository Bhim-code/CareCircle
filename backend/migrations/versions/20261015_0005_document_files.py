"""document files: health documents can carry an uploaded PDF or photo, can be
"deleted" (hidden, file kept), and two new permissions: documents.upload / documents.view.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-15 17:38:37.837344

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    for name, column in [
        ('file_key', sa.String(length=200)), ('content_type', sa.String(length=40)),
        ('size_bytes', sa.Integer()), ('file_name', sa.String(length=100)),
        ('uploaded_by', sa.UUID()), ('deleted_at', sa.DateTime(timezone=True)), ('deleted_by', sa.UUID()),
    ]:
        op.add_column('health_documents', sa.Column(name, column, nullable=True))
    op.create_unique_constraint('health_documents_file_key_key', 'health_documents', ['file_key'])
    op.create_foreign_key('health_documents_uploaded_by_fkey', 'health_documents', 'users',
                          ['uploaded_by'], ['id'], ondelete='RESTRICT')
    op.create_foreign_key('health_documents_deleted_by_fkey', 'health_documents', 'users',
                          ['deleted_by'], ['id'], ondelete='RESTRICT')
    op.create_check_constraint(
        'health_documents_file_complete', 'health_documents',
        "(file_key IS NULL) = (content_type IS NULL) AND (file_key IS NULL) = (size_bytes IS NULL)")
    op.create_check_constraint(
        'health_documents_type_valid', 'health_documents',
        "content_type IS NULL OR content_type IN ('application/pdf', 'image/jpeg', 'image/png')")
    op.create_check_constraint(
        'health_documents_size_valid', 'health_documents',
        "size_bytes IS NULL OR (size_bytes > 0 AND size_bytes <= 10485760)")
    op.create_check_constraint('health_documents_deleted_by', 'health_documents',
                               "(deleted_at IS NULL) = (deleted_by IS NULL)")

    # New permissions, given to the built-in Patient and Caregiver roles.
    op.execute("""
        INSERT INTO permissions (code, description) VALUES
          ('documents.upload', 'Upload health documents (own, or for linked patients)'),
          ('documents.view', 'Open health documents (own, or of linked patients)')
    """)
    op.execute("""
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r, permissions p
        WHERE r.is_system AND r.kind IN ('patient', 'caregiver')
          AND p.code IN ('documents.upload', 'documents.view')
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM permissions WHERE code IN ('documents.upload', 'documents.view')")
    for name in ('health_documents_deleted_by', 'health_documents_size_valid',
                 'health_documents_type_valid', 'health_documents_file_complete'):
        op.drop_constraint(name, 'health_documents', type_='check')
    op.drop_constraint('health_documents_deleted_by_fkey', 'health_documents', type_='foreignkey')
    op.drop_constraint('health_documents_uploaded_by_fkey', 'health_documents', type_='foreignkey')
    op.drop_constraint('health_documents_file_key_key', 'health_documents', type_='unique')
    for name in ('deleted_by', 'deleted_at', 'uploaded_by', 'file_name', 'size_bytes', 'content_type', 'file_key'):
        op.drop_column('health_documents', name)
