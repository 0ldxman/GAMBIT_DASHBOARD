"""Ход игры: правила автоизменений, счётчик хода и снимки для отката.

Revision ID: 0016_turns
Revises: 0015_dm_outbox
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0016_turns"
down_revision = "0015_dm_outbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project",
        sa.Column("turn_number", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "entity_type",
        sa.Column(
            "turn_rules",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "entity",
        sa.Column(
            "turn_rules",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.create_table(
        "turn_snapshot",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("turn_number", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    # Откат берёт самый свежий снимок проекта — ищем по (project_id, id desc).
    op.create_index("ix_turn_snapshot_project", "turn_snapshot", ["project_id", "id"])


def downgrade() -> None:
    op.drop_index("ix_turn_snapshot_project", table_name="turn_snapshot")
    op.drop_table("turn_snapshot")
    op.drop_column("entity", "turn_rules")
    op.drop_column("entity_type", "turn_rules")
    op.drop_column("project", "turn_number")
