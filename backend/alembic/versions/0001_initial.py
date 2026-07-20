"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-19

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("type", sa.String(length=100), nullable=False),
        sa.Column("desc", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "project_channel",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", sa.BigInteger(), nullable=False),
        sa.Column("channel_type", sa.String(length=50), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False),
    )

    op.create_table(
        "entity_type",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("attributes_template", sa.Text(), nullable=False),
    )

    op.create_table(
        "entity",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type_id", sa.Integer(), sa.ForeignKey("entity_type.id", ondelete="SET NULL"), nullable=True),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("picture", sa.String(length=500), nullable=False),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("entity.id", ondelete="SET NULL"), nullable=True),
        sa.Column("attributes", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    )

    op.create_table(
        "project_entity",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entity_id", sa.Integer(), sa.ForeignKey("entity.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("player_id", sa.BigInteger(), nullable=True),
    )

    op.create_table(
        "project_post",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", sa.Integer(), sa.ForeignKey("project_channel.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("status", sa.Enum("draft", "scheduled", "published", name="post_status"), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("attachments", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("entity_edits", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("reply_to", sa.Integer(), sa.ForeignKey("project_post.id", ondelete="SET NULL"), nullable=True),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_message_id", sa.BigInteger(), nullable=True),
        sa.Column("created_by", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_by", sa.String(length=120), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("project_post")
    op.drop_table("project_entity")
    op.drop_table("entity")
    op.drop_table("entity_type")
    op.drop_table("project_channel")
    op.drop_table("project")
    sa.Enum(name="post_status").drop(op.get_bind(), checkfirst=True)
