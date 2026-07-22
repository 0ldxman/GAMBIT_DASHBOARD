"""Вычисляемые поля типа сущности (формулы от атрибутов).

Revision ID: 0011_computed
Revises: 0010_pages_proxy
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0011_computed"
down_revision = "0010_pages_proxy"
branch_labels = None
depends_on = None

EMPTY_ARRAY = sa.text("'[]'::jsonb")


def upgrade() -> None:
    op.add_column(
        "entity_type",
        sa.Column(
            "computed",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=EMPTY_ARRAY,
        ),
    )


def downgrade() -> None:
    op.drop_column("entity_type", "computed")
