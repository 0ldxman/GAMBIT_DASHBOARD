"""Роли проекта списком с уровнем доступа вместо master_role_id/player_role_id.

Revision ID: 0006_project_roles
Revises: 0005_members_rel
"""

from alembic import op
import sqlalchemy as sa

revision = "0006_project_roles"
down_revision = "0005_members_rel"
branch_labels = None
depends_on = None

access_level = sa.Enum("admin", "moderator", "player", name="access_level")


def upgrade() -> None:
    # CREATE TYPE выпускает сам create_table — отдельный вызов create() дал бы
    # второй CREATE TYPE и падение при накатывании через alembic --sql.
    op.create_table(
        "project_role",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("project.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False, server_default=""),
        sa.Column(
            "access_level", access_level, nullable=False, server_default="player"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("project_id", "role_id", name="uq_project_role"),
    )

    # Переносим прежние две роли: мастерская → admin, игроцкая → player.
    op.execute(
        """
        INSERT INTO project_role (project_id, role_id, name, access_level)
        SELECT id, master_role_id, 'Мастера', 'admin'
        FROM project WHERE master_role_id IS NOT NULL
        """
    )
    op.execute(
        """
        INSERT INTO project_role (project_id, role_id, name, access_level)
        SELECT id, player_role_id, 'Игроки', 'player'
        FROM project WHERE player_role_id IS NOT NULL
          AND player_role_id <> COALESCE(master_role_id, 0)
        """
    )

    op.drop_column("project", "master_role_id")
    op.drop_column("project", "player_role_id")


def downgrade() -> None:
    op.add_column("project", sa.Column("master_role_id", sa.BigInteger(), nullable=True))
    op.add_column("project", sa.Column("player_role_id", sa.BigInteger(), nullable=True))

    # Обратно помещается только по одной роли каждого вида — берём самую раннюю.
    op.execute(
        """
        UPDATE project p SET master_role_id = r.role_id
        FROM (
            SELECT DISTINCT ON (project_id) project_id, role_id
            FROM project_role WHERE access_level IN ('admin', 'moderator')
            ORDER BY project_id, id
        ) r WHERE r.project_id = p.id
        """
    )
    op.execute(
        """
        UPDATE project p SET player_role_id = r.role_id
        FROM (
            SELECT DISTINCT ON (project_id) project_id, role_id
            FROM project_role WHERE access_level = 'player'
            ORDER BY project_id, id
        ) r WHERE r.project_id = p.id
        """
    )

    op.drop_table("project_role")
    access_level.drop(op.get_bind(), checkfirst=True)
