"""Собственные вычисляемые поля сущности (дополняют формулы типа).

Revision ID: 0012_entity_computed
Revises: 0011_computed
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0012_entity_computed"
down_revision = "0011_computed"
branch_labels = None
depends_on = None

EMPTY_ARRAY = sa.text("'[]'::jsonb")


def upgrade() -> None:
    op.add_column(
        "entity",
        sa.Column(
            "computed",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=EMPTY_ARRAY,
        ),
    )


def downgrade() -> None:
    op.drop_column("entity", "computed")
