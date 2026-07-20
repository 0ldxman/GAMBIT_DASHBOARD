"""Синхронизация доступа игроков к Discord-каналам сущностей.

Правило: доступ к каналу = ОБЪЕДИНЕНИЕ участников всех сущностей, привязанных
к этому каналу с sync_access. Поэтому снятие игрока с одной сущности не выкидывает
его из канала организации, если он остаётся участником другой связанной сущности.

Канал с sync_access считается управляемым: пользовательские overwrite'ы на нём
приводятся к рассчитанному множеству. Роли (мастера/игроки проекта) и сам бот
не трогаются.
"""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import discord_api
from app.discord_api import DiscordError
from app.models import Entity
from app.models import EntityChannel
from app.models import EntityMember
from app.models import Project

logger = logging.getLogger(__name__)


async def _bot_user_id() -> Optional[int]:
    """ID самого бота — его overwrite снимать нельзя, иначе потеряет канал."""
    try:
        me = await discord_api._get("/users/@me")  # noqa: SLF001 — внутренний помощник модуля
        return int(me["id"])
    except (DiscordError, KeyError, ValueError):
        return None


async def allowed_players_for_channel(discord_channel_id: int, db: AsyncSession) -> set[int]:
    """Кто должен видеть канал: участники всех связанных сущностей."""
    result = await db.execute(
        select(EntityMember.player_id)
        .join(EntityChannel, EntityChannel.entity_id == EntityMember.entity_id)
        .where(
            EntityChannel.discord_channel_id == discord_channel_id,
            EntityChannel.sync_access.is_(True),
        )
    )
    return {row[0] for row in result.all() if row[0]}


async def _project_for_channel(discord_channel_id: int, db: AsyncSession) -> Optional[Project]:
    result = await db.execute(
        select(Project)
        .join(Entity, Entity.project_id == Project.id)
        .join(EntityChannel, EntityChannel.entity_id == Entity.id)
        .where(EntityChannel.discord_channel_id == discord_channel_id)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def sync_channel_access(discord_channel_id: int, db: AsyncSession) -> dict[str, int]:
    """Привести права канала в соответствие с привязками. Возвращает сводку."""
    desired = await allowed_players_for_channel(discord_channel_id, db)
    project = await _project_for_channel(discord_channel_id, db)

    try:
        overwrites = await discord_api.list_channel_overwrites(discord_channel_id)
    except DiscordError:
        logger.exception("Не удалось прочитать права канала %s", discord_channel_id)
        raise

    bot_id = await _bot_user_id()
    # type 1 — пользовательские overwrite'ы; только их и пересчитываем.
    current_users = {
        int(o["id"]) for o in overwrites if str(o.get("type")) in ("1", "member")
    }
    if bot_id:
        current_users.discard(bot_id)

    added = 0
    for player_id in desired - current_users:
        await discord_api.allow_user_in_channel(discord_channel_id, player_id)
        added += 1

    removed = 0
    for player_id in current_users - desired:
        await discord_api.remove_overwrite(discord_channel_id, player_id)
        removed += 1

    # Роли доступа проекта держим открытыми всегда.
    roles = 0
    if project:
        for role_id in (project.master_role_id, project.player_role_id):
            if role_id:
                await discord_api.allow_role_in_channel(discord_channel_id, role_id)
                roles += 1

    logger.info(
        "Канал %s: +%d, -%d игроков, ролей %d", discord_channel_id, added, removed, roles
    )
    return {"allowed": len(desired), "added": added, "removed": removed, "roles": roles}


async def sync_entity_channels(entity_id: int, db: AsyncSession) -> list[dict[str, int]]:
    """Пересинхронизировать все каналы сущности (после смены состава игроков)."""
    result = await db.execute(
        select(EntityChannel.discord_channel_id).where(
            EntityChannel.entity_id == entity_id, EntityChannel.sync_access.is_(True)
        )
    )
    summaries = []
    for (channel_id,) in result.all():
        try:
            summaries.append(await sync_channel_access(channel_id, db))
        except DiscordError as exc:
            # Один недоступный канал не должен ронять всю операцию.
            logger.warning("Канал %s не синхронизирован: %s", channel_id, exc)
    return summaries
