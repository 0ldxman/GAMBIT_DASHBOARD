"""Отдельный автор эмбеда — независимо от идентичности вебхука.

Revision ID: 0007_embed_author
Revises: 0006_project_roles
"""

from alembic import op
import sqlalchemy as sa

revision = "0007_embed_author"
down_revision = "0006_project_roles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_post",
        sa.Column("embed_author_name", sa.String(length=200), nullable=False, server_default=""),
    )
    op.add_column(
        "project_post",
        sa.Column(
            "embed_author_icon_url", sa.String(length=500), nullable=False, server_default=""
        ),
    )
    # Ничего не переносим из author_name: автор эмбеда задаётся только явно,
    # иначе у старых черновиков появился бы автор, которого мастер не писал.


def downgrade() -> None:
    op.drop_column("project_post", "embed_author_icon_url")
    op.drop_column("project_post", "embed_author_name")
