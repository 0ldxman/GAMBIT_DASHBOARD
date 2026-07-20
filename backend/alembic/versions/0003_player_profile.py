"""player profile cache on project_entity

Revision ID: 0003_player_profile
Revises: 0002_bot_features
Create Date: 2026-07-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003_player_profile"
down_revision: Union[str, None] = "0002_bot_features"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "project_entity",
        sa.Column("player_name", sa.String(length=120), nullable=False, server_default=""),
    )
    op.add_column(
        "project_entity",
        sa.Column("player_avatar_url", sa.String(length=500), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("project_entity", "player_avatar_url")
    op.drop_column("project_entity", "player_name")
