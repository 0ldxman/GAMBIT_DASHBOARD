from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import discord_api
from app.access import sync_channel_access
from app.database import get_db
from app.discord_api import DiscordError
from app.models import Entity
from app.models import EntityChannel
from app.models import ProjectChannel
from app.routers.projects import get_project_or_404
from app.schemas import CategoryNodeOut
from app.schemas import ChannelCreate
from app.schemas import ChannelNodeOut
from app.schemas import ChannelOut
from app.schemas import ChannelTreeOut
from app.schemas import ChannelUpdate
from app.schemas import DiscordChannelOut
from app.schemas import EntityLinkOut
from app.security import require_master

router = APIRouter(
    prefix="/projects/{project_id}/channels",
    tags=["channels"],
    dependencies=[Depends(require_master)],
)

# Категории каналов не содержат, поэтому в списках их не показываем.
CONTENT_TYPES = ("text", "news", "forum", "voice", "stage")


async def get_channel_or_404(
    project_id: int, channel_pk: int, db: AsyncSession
) -> ProjectChannel:
    channel = await db.get(ProjectChannel, channel_pk)
    if channel is None or channel.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Канал не найден")
    return channel


async def _entity_links(project_id: int, db: AsyncSession) -> dict[int, list[EntityLinkOut]]:
    """Привязки сущностей к каналам проекта: channel_id → список сущностей."""
    result = await db.execute(
        select(EntityChannel, Entity.label)
        .join(Entity, Entity.id == EntityChannel.entity_id)
        .where(Entity.project_id == project_id)
    )
    links: dict[int, list[EntityLinkOut]] = {}
    for link, label in result.all():
        links.setdefault(link.discord_channel_id, []).append(
            EntityLinkOut(
                link_id=link.id,
                entity_id=link.entity_id,
                entity_label=label,
                sync_access=link.sync_access,
            )
        )
    return links


async def _project_rows(project_id: int, db: AsyncSession) -> list[ProjectChannel]:
    result = await db.execute(
        select(ProjectChannel).where(ProjectChannel.project_id == project_id)
    )
    return list(result.scalars().all())


@router.get("/tree", response_model=ChannelTreeOut)
async def channel_tree(project_id: int, db: AsyncSession = Depends(get_db)) -> ChannelTreeOut:
    """Категории проекта с автоматически собранными каналами внутри.

    Каналы не хранятся в БД: их состав всегда берётся из Discord, поэтому дашборд
    не расходится с сервером, если канал создали или удалили мимо него.
    """
    project = await get_project_or_404(project_id, db)
    rows = await _project_rows(project_id, db)
    categories = [r for r in rows if r.channel_type == "category"]
    registered = {r.channel_id: r for r in rows if r.channel_type != "category"}
    links = await _entity_links(project_id, db)

    if not project.guild_id:
        return ChannelTreeOut(error="У проекта не выбран Discord-сервер")

    try:
        guild_channels = await discord_api.list_guild_channels(project.guild_id)
    except DiscordError as exc:
        # Discord недоступен — показываем хотя бы категории, чтобы экран не был пустым.
        return ChannelTreeOut(
            categories=[
                CategoryNodeOut(id=c.id, channel_id=str(c.channel_id), name=c.label)
                for c in categories
            ],
            error=str(exc),
        )

    by_parent: dict[str, list[dict]] = {}
    for ch in guild_channels:
        if ch["type"] in CONTENT_TYPES and ch["parent_id"]:
            by_parent.setdefault(ch["parent_id"], []).append(ch)
    known = {c["channel_id"]: c for c in guild_channels}

    def node(ch: dict) -> ChannelNodeOut:
        cid = int(ch["channel_id"])
        row = registered.get(cid)
        return ChannelNodeOut(
            channel_id=ch["channel_id"],
            name=ch["name"],
            type=ch["type"],
            position=ch["position"],
            registered_id=row.id if row else None,
            entities=links.get(cid, []),
        )

    out_categories: list[CategoryNodeOut] = []
    covered: set[int] = set()
    for cat in categories:
        key = str(cat.channel_id)
        live = known.get(key)
        children = sorted(by_parent.get(key, []), key=lambda c: c["position"])
        covered.update(int(c["channel_id"]) for c in children)
        out_categories.append(
            CategoryNodeOut(
                id=cat.id,
                channel_id=key,
                # Имя из Discord свежее закэшированного в label.
                name=(live["name"] if live else cat.label) or key,
                missing=live is None,
                channels=[node(c) for c in children],
            )
        )

    # Явно зарегистрированные каналы вне категорий проекта.
    loose = [
        node(known[str(cid)])
        for cid in registered
        if cid not in covered and str(cid) in known
    ]

    return ChannelTreeOut(categories=out_categories, loose=loose)


@router.get("/available", response_model=list[DiscordChannelOut])
async def available_channels(
    project_id: int, db: AsyncSession = Depends(get_db)
) -> list[DiscordChannelOut]:
    """Каналы, которыми владеет проект.

    Один и тот же список используется и на экране каналов, и при выдаче доступа
    сущности — чтобы мастер везде видел одинаковый набор.
    """
    project = await get_project_or_404(project_id, db)
    if not project.guild_id:
        return []
    try:
        guild_channels = await discord_api.list_guild_channels(project.guild_id)
    except DiscordError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))

    rows = await _project_rows(project_id, db)
    category_ids = {str(r.channel_id) for r in rows if r.channel_type == "category"}
    registered_ids = {str(r.channel_id) for r in rows if r.channel_type != "category"}

    return [
        DiscordChannelOut(**ch)
        for ch in guild_channels
        if ch["type"] in CONTENT_TYPES
        and (ch["parent_id"] in category_ids or ch["channel_id"] in registered_ids)
    ]


@router.get("", response_model=list[ChannelOut])
async def list_channels(
    project_id: int, db: AsyncSession = Depends(get_db)
) -> list[ProjectChannel]:
    await get_project_or_404(project_id, db)
    return await _project_rows(project_id, db)


@router.post("", response_model=ChannelOut, status_code=status.HTTP_201_CREATED)
async def add_channel(
    project_id: int, body: ChannelCreate, db: AsyncSession = Depends(get_db)
) -> ProjectChannel:
    await get_project_or_404(project_id, db)
    channel = ProjectChannel(project_id=project_id, **body.model_dump())
    db.add(channel)
    await db.commit()
    await db.refresh(channel)
    return channel


@router.patch("/{channel_pk}", response_model=ChannelOut)
async def update_channel(
    project_id: int, channel_pk: int, body: ChannelUpdate, db: AsyncSession = Depends(get_db)
) -> ProjectChannel:
    channel = await get_channel_or_404(project_id, channel_pk, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(channel, field, value)
    await db.commit()
    await db.refresh(channel)
    return channel


@router.delete("/{channel_pk}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(
    project_id: int, channel_pk: int, db: AsyncSession = Depends(get_db)
) -> None:
    channel = await get_channel_or_404(project_id, channel_pk, db)
    await db.delete(channel)
    await db.commit()


# ---------- доступ сущностей к каналу (то же, что на экране сущности) ----------
@router.post("/{discord_channel_id}/entities/{entity_id}", response_model=EntityLinkOut)
async def grant_entity(
    project_id: int,
    discord_channel_id: int,
    entity_id: int,
    db: AsyncSession = Depends(get_db),
) -> EntityLinkOut:
    """Дать сущности доступ к каналу прямо с экрана каналов."""
    await get_project_or_404(project_id, db)
    entity = await db.get(Entity, entity_id)
    if entity is None or entity.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сущность не найдена")

    existing = await db.execute(
        select(EntityChannel).where(
            EntityChannel.entity_id == entity_id,
            EntityChannel.discord_channel_id == discord_channel_id,
        )
    )
    link = existing.scalar_one_or_none()
    if link is None:
        link = EntityChannel(
            entity_id=entity_id,
            discord_channel_id=discord_channel_id,
            label="",
            sync_access=True,
        )
        db.add(link)
        await db.commit()
        await db.refresh(link)

    try:
        await sync_channel_access(discord_channel_id, db)
    except DiscordError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))

    return EntityLinkOut(
        link_id=link.id,
        entity_id=entity_id,
        entity_label=entity.label,
        sync_access=link.sync_access,
    )


@router.delete(
    "/{discord_channel_id}/entities/{entity_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def revoke_entity(
    project_id: int,
    discord_channel_id: int,
    entity_id: int,
    db: AsyncSession = Depends(get_db),
) -> None:
    await get_project_or_404(project_id, db)
    result = await db.execute(
        select(EntityChannel).where(
            EntityChannel.entity_id == entity_id,
            EntityChannel.discord_channel_id == discord_channel_id,
        )
    )
    link = result.scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Привязка не найдена")
    await db.delete(link)
    await db.commit()
    # Пересчёт уже без этой привязки: игрок останется, если проходит через другую.
    try:
        await sync_channel_access(discord_channel_id, db)
    except DiscordError:
        pass
