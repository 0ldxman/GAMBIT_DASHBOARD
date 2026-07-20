"""Заготовка атрибутов у типа сущности.

Revision ID: 0008_type_schema
Revises: 0007_embed_author
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0008_type_schema"
down_revision = "0007_embed_author"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "entity_type",
        sa.Column(
            "attributes_schema",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("entity_type", "attributes_schema")
