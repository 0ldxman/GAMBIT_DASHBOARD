"""Связь сущностей: иерархическая или взаимная.

Все связи, заведённые до этой миграции, создавались ручкой «добавить дочернюю»
и означали иерархию — поэтому существующие строки помечаются directed=true, а
по умолчанию новые связи взаимные («союзник», «война»).

Revision ID: 0014_relation_directed
Revises: 0013_page_colors
"""

from alembic import op
import sqlalchemy as sa

revision = "0014_relation_directed"
down_revision = "0013_page_colors"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "entity_relation",
        sa.Column("directed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.execute("UPDATE entity_relation SET directed = true")


def downgrade() -> None:
    op.drop_column("entity_relation", "directed")
