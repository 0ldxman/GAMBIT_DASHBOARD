"""Очередь личных сообщений игрокам и причина решения по заявке.

Revision ID: 0015_dm_outbox
Revises: 0014_relation_directed
"""

from alembic import op
import sqlalchemy as sa

revision = "0015_dm_outbox"
down_revision = "0014_relation_directed"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "registration",
        sa.Column("review_note", sa.Text(), nullable=False, server_default=""),
    )
    op.create_table(
        "direct_message",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.BigInteger(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("color", sa.String(length=7), nullable=False, server_default=""),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    # Бот раз в несколько секунд спрашивает «что не отправлено» — без индекса
    # это был бы seq scan по всей истории переписки.
    op.create_index(
        "ix_direct_message_pending",
        "direct_message",
        ["sent_at", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_direct_message_pending", table_name="direct_message")
    op.drop_table("direct_message")
    op.drop_column("registration", "review_note")
