"""Цвет полосы эмбеда для каждой страницы описания.

Revision ID: 0013_page_colors
Revises: 0012_entity_computed
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0013_page_colors"
down_revision = "0012_entity_computed"
branch_labels = None
depends_on = None

EMPTY_ARRAY = sa.text("'[]'::jsonb")


def _column() -> sa.Column:
    return sa.Column(
        "page_colors",
        postgresql.JSONB(astext_type=sa.Text()),
        nullable=False,
        server_default=EMPTY_ARRAY,
    )


def upgrade() -> None:
    op.add_column("entity_type", _column())
    op.add_column("entity", _column())


def downgrade() -> None:
    op.drop_column("entity", "page_colors")
    op.drop_column("entity_type", "page_colors")
