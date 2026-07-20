"""Определение проекта по каналу, где выполнена команда бота.

На одном Discord-сервере живёт несколько ВПИ, поэтому guild_id больше не
определяет проект однозначно. Владение выражается через категории:
проект регистрирует категорию, и всё внутри неё принадлежит ему.

Порядок разрешения:
  1. канал зарегистрирован в проекте явно;
  2. зарегистрирована его категория (родитель);
  3. канал привязан к сущности проекта;
  4. на сервере ровно один проект — берём его;
  5. иначе неоднозначно.
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
from app.models import Project
from app.models import ProjectChannel

logger = logging.getLogger(__name__)


async def project_for_channel(
    guild_id: int, channel_id: int, db: AsyncSession
) -> Optional[Project]:
    # 1. Канал зарегистрирован напрямую.
    result = await db.execute(
        select(Project)
        .join(ProjectChannel, ProjectChannel.project_id == Project.id)
        .where(ProjectChannel.channel_id == channel_id)
        .limit(1)
    )
    project = result.scalar_one_or_none()
    if project:
        return project

    # 2. Зарегистрирована категория канала. Родителя берём из кэша, а если его
    #    там нет — спрашиваем у Discord (канал могли создать вручную).
    parent_id: Optional[int] = None
    result = await db.execute(
        select(ProjectChannel.discord_parent_id).where(ProjectChannel.channel_id == channel_id)
    )
    row = result.first()
    if row and row[0]:
        parent_id = row[0]
    else:
        try:
            info = await discord_api.get_channel(channel_id)
            parent_id = int(info["parent_id"]) if info.get("parent_id") else None
        except (DiscordError, ValueError):
            parent_id = None

    if parent_id:
        result = await db.execute(
            select(Project)
            .join(ProjectChannel, ProjectChannel.project_id == Project.id)
            .where(ProjectChannel.channel_id == parent_id)
            .limit(1)
        )
        project = result.scalar_one_or_none()
        if project:
            return project

    # 3. Канал привязан к сущности проекта.
    result = await db.execute(
        select(Project)
        .join(Entity, Entity.project_id == Project.id)
        .join(EntityChannel, EntityChannel.entity_id == Entity.id)
        .where(EntityChannel.discord_channel_id == channel_id)
        .limit(1)
    )
    project = result.scalar_one_or_none()
    if project:
        return project

    # 4. Единственный проект на сервере — однозначно он.
    result = await db.execute(select(Project).where(Project.guild_id == guild_id).limit(2))
    projects = list(result.scalars().all())
    if len(projects) == 1:
        return projects[0]

    return None
