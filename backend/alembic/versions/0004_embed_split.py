"""split embed fields from message text

Revision ID: 0004_embed_split
Revises: 0003_player_profile
Create Date: 2026-07-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004_embed_split"
down_revision: Union[str, None] = "0003_player_profile"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "project_post",
        sa.Column("embed_title", sa.String(length=300), nullable=False, server_default=""),
    )
    op.add_column(
        "project_post",
        sa.Column("embed_description", sa.Text(), nullable=False, server_default=""),
    )
    # Раньше эмбед брал заголовок из title, а описание из content.
    # Переносим данные существующих вердов, чтобы они не потеряли вид.
    op.execute(
        """
        UPDATE project_post
        SET embed_title = title, embed_description = content
        WHERE use_embed = true
        """
    )


def downgrade() -> None:
    op.drop_column("project_post", "embed_description")
    op.drop_column("project_post", "embed_title")
