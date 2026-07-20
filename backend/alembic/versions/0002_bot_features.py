"""bot features: webhooks, author/embed posts, forms, registrations, notifications

Revision ID: 0002_bot_features
Revises: 0001_initial
Create Date: 2026-07-19

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0002_bot_features"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # project.guild_id
    op.add_column("project", sa.Column("guild_id", sa.BigInteger(), nullable=True))
    op.create_unique_constraint("uq_project_guild_id", "project", ["guild_id"])

    # project_post: target channel + author/embed
    op.add_column("project_post", sa.Column("target_channel_id", sa.BigInteger(), nullable=True))
    op.add_column("project_post", sa.Column("author_name", sa.String(length=200), nullable=False, server_default=""))
    op.add_column("project_post", sa.Column("author_avatar_url", sa.String(length=500), nullable=False, server_default=""))
    op.add_column("project_post", sa.Column("use_embed", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("project_post", sa.Column("embed_image_url", sa.String(length=500), nullable=False, server_default=""))
    op.add_column("project_post", sa.Column("embed_color", sa.String(length=20), nullable=False, server_default=""))

    # channel_webhook
    op.create_table(
        "channel_webhook",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("project.id", ondelete="SET NULL"), nullable=True),
        sa.Column("discord_channel_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("webhook_id", sa.BigInteger(), nullable=False),
        sa.Column("webhook_token", sa.String(length=200), nullable=False),
        sa.Column("webhook_url", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # registration_form
    op.create_table(
        "registration_form",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False, server_default="Регистрация"),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_open", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # registration
    op.create_table(
        "registration",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("form_id", sa.Integer(), sa.ForeignKey("registration_form.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=False),
        sa.Column("discord_user_id", sa.BigInteger(), nullable=False),
        sa.Column("discord_username", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("answers", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("status", sa.Enum("pending", "approved", "rejected", name="registration_status"), nullable=False, server_default="pending"),
        sa.Column("entity_id", sa.Integer(), sa.ForeignKey("entity.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_by", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # notification
    op.create_table(
        "notification",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.Enum("ping", "registration", "system", name="notification_type"), nullable=False, server_default="system"),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("entity_id", sa.Integer(), sa.ForeignKey("entity.id", ondelete="SET NULL"), nullable=True),
        sa.Column("player_id", sa.BigInteger(), nullable=True),
        sa.Column("discord_channel_id", sa.BigInteger(), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("notification")
    op.drop_table("registration")
    op.drop_table("registration_form")
    op.drop_table("channel_webhook")
    op.drop_column("project_post", "embed_color")
    op.drop_column("project_post", "embed_image_url")
    op.drop_column("project_post", "use_embed")
    op.drop_column("project_post", "author_avatar_url")
    op.drop_column("project_post", "author_name")
    op.drop_column("project_post", "target_channel_id")
    op.drop_constraint("uq_project_guild_id", "project", type_="unique")
    op.drop_column("project", "guild_id")
    sa.Enum(name="registration_status").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="notification_type").drop(op.get_bind(), checkfirst=True)
