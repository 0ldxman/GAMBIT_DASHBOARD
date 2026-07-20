"""multi-project guilds, entity members with roles, typed relations, entity channels

Revision ID: 0005_members_rel
Revises: 0004_embed_split
Create Date: 2026-07-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0005_members_rel"
down_revision: Union[str, None] = "0004_embed_split"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- проект: несколько проектов на сервере + роли доступа ---
    op.drop_constraint("uq_project_guild_id", "project", type_="unique")
    op.add_column("project", sa.Column("master_role_id", sa.BigInteger(), nullable=True))
    op.add_column("project", sa.Column("player_role_id", sa.BigInteger(), nullable=True))

    # --- канал знает свою категорию: по ней определяется владелец-проект ---
    op.add_column(
        "project_channel", sa.Column("discord_parent_id", sa.BigInteger(), nullable=True)
    )

    # --- участники сущности (заменяет project_entity) ---
    op.create_table(
        "entity_member",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("entity_id", sa.Integer(), sa.ForeignKey("entity.id", ondelete="CASCADE"), nullable=False),
        sa.Column("player_id", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("player_name", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("player_avatar_url", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("entity_id", "player_id", name="uq_entity_member"),
    )
    # Переносим существующие привязки как основных игроков.
    op.execute(
        """
        INSERT INTO entity_member
            (entity_id, player_id, role, is_primary, player_name, player_avatar_url)
        SELECT entity_id, player_id, '', true,
               COALESCE(player_name, ''), COALESCE(player_avatar_url, '')
        FROM project_entity
        WHERE player_id IS NOT NULL
        """
    )

    # --- типизированные связи сущностей (заменяет entity.parent_id) ---
    op.create_table(
        "entity_relation",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("entity.id", ondelete="CASCADE"), nullable=False),
        sa.Column("child_id", sa.Integer(), sa.ForeignKey("entity.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relation_type", sa.String(length=120), nullable=False, server_default="состав"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("parent_id", "child_id", "relation_type", name="uq_entity_relation"),
    )
    op.execute(
        """
        INSERT INTO entity_relation (parent_id, child_id, relation_type)
        SELECT parent_id, id, 'состав' FROM entity WHERE parent_id IS NOT NULL
        """
    )

    # --- каналы сущностей ---
    op.create_table(
        "entity_channel",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("entity_id", sa.Integer(), sa.ForeignKey("entity.id", ondelete="CASCADE"), nullable=False),
        sa.Column("discord_channel_id", sa.BigInteger(), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("sync_access", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("entity_id", "discord_channel_id", name="uq_entity_channel"),
    )

    # Старые структуры убираем только после переноса данных.
    op.drop_column("entity", "parent_id")
    op.drop_table("project_entity")


def downgrade() -> None:
    op.add_column("entity", sa.Column("parent_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "entity_parent_id_fkey", "entity", "entity", ["parent_id"], ["id"], ondelete="SET NULL"
    )
    op.execute(
        """
        UPDATE entity e SET parent_id = r.parent_id
        FROM entity_relation r
        WHERE r.child_id = e.id AND r.relation_type = 'состав'
        """
    )
    op.create_table(
        "project_entity",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("project.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entity_id", sa.Integer(), sa.ForeignKey("entity.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("player_id", sa.BigInteger(), nullable=True),
        sa.Column("player_name", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("player_avatar_url", sa.String(length=500), nullable=False, server_default=""),
    )
    op.execute(
        """
        INSERT INTO project_entity (project_id, entity_id, player_id, player_name, player_avatar_url)
        SELECT e.project_id, m.entity_id, m.player_id, m.player_name, m.player_avatar_url
        FROM entity_member m JOIN entity e ON e.id = m.entity_id
        WHERE m.is_primary = true
        """
    )
    op.drop_table("entity_channel")
    op.drop_table("entity_relation")
    op.drop_table("entity_member")
    op.drop_column("project", "player_role_id")
    op.drop_column("project", "master_role_id")
    op.drop_column("project_channel", "discord_parent_id")
    op.create_unique_constraint("uq_project_guild_id", "project", ["guild_id"])
