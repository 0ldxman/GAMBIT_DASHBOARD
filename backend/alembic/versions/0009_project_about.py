"""Карточка проекта для /about: авторы и одно вложение в эмбед.

Revision ID: 0009_project_about
Revises: 0008_type_schema
"""

from alembic import op
import sqlalchemy as sa

revision = "0009_project_about"
down_revision = "0008_type_schema"
branch_labels = None
depends_on = None

COLUMNS = (
    ("authors", sa.Text()),
    ("media_url", sa.String(length=500)),
    ("media_filename", sa.String(length=200)),
    ("media_content_type", sa.String(length=120)),
)


def upgrade() -> None:
    for name, type_ in COLUMNS:
        op.add_column(
            "project",
            sa.Column(name, type_, nullable=False, server_default=""),
        )


def downgrade() -> None:
    for name, _ in reversed(COLUMNS):
        op.drop_column("project", name)
