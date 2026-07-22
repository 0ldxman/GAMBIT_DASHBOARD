"""Страницы описаний, шаблоны вердов, авто-подмена от лица сущности.

Revision ID: 0010_pages_proxy
Revises: 0009_project_about
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0010_pages_proxy"
down_revision = "0009_project_about"
branch_labels = None
depends_on = None

EMPTY_ARRAY = sa.text("'[]'::jsonb")
EMPTY_OBJECT = sa.text("'{}'::jsonb")


def upgrade() -> None:
    # --- страницы описаний ---
    op.add_column(
        "entity_type",
        sa.Column("description_pages", postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=EMPTY_ARRAY),
    )
    # Существующий шаблон становится первой страницей: иначе после накатывания
    # у всех типов описание оказалось бы пустым.
    op.execute(
        """
        UPDATE entity_type
           SET description_pages = jsonb_build_array(attributes_template)
         WHERE COALESCE(attributes_template, '') <> ''
        """
    )
    op.add_column(
        "entity",
        sa.Column("use_custom_description", sa.Boolean(), nullable=False,
                  server_default=sa.text("false")),
    )
    op.add_column(
        "entity",
        sa.Column("description_pages", postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=EMPTY_ARRAY),
    )

    # --- шаблоны вердов ---
    op.create_table(
        "post_template",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(),
                  sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=EMPTY_ARRAY),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=EMPTY_OBJECT),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_post_template_project", "post_template", ["project_id"])

    # --- авто-подмена ---
    op.create_table(
        "channel_setting",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(),
                  sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=False),
        sa.Column("discord_channel_id", sa.BigInteger(), nullable=False),
        sa.Column("auto_proxy", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("discord_channel_id", name="uq_channel_setting_channel"),
    )
    op.create_table(
        "proxy_choice",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("player_id", sa.BigInteger(), nullable=False),
        sa.Column("discord_channel_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_id", sa.Integer(),
                  sa.ForeignKey("entity.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("player_id", "discord_channel_id", name="uq_proxy_choice"),
    )


def downgrade() -> None:
    op.drop_table("proxy_choice")
    op.drop_table("channel_setting")
    op.drop_index("ix_post_template_project", table_name="post_template")
    op.drop_table("post_template")
    op.drop_column("entity", "description_pages")
    op.drop_column("entity", "use_custom_description")
    # attributes_template не трогаем: первая страница и так осталась в нём.
    op.drop_column("entity_type", "description_pages")
