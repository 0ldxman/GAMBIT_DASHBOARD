"""Справочники из Discord для дашборда: список каналов сервера, профиль участника."""

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select

from app.access import master_role_ids
from app.database import get_db
from app.discord_api import DiscordError
from app.discord_api import create_channel
from app.discord_api import delete_channel as discord_delete_channel
from app.discord_api import get_guild_member
from app.discord_api import list_guild_channels
from app.discord_api import list_guild_roles
from app.models import Entity
from app.models import EntityChannel
from app.models import EntityMember
from app.models import ProjectChannel
from app.routers.projects import get_project_or_404
from app.schemas import CreateChannelRequest
from app.schemas import DiscordChannelOut
from app.schemas import DiscordMemberOut
from app.schemas import DiscordRoleOut
from app.security import require_master

router = APIRouter(
    prefix="/projects/{project_id}/discord",
    tags=["discord"],
    dependencies=[Depends(require_master)],
)


async def _guild_id(project_id: int, db: AsyncSession) -> int:
    project = await get_project_or_404(project_id, db)
    if not project.guild_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="У проекта не указан Discord server (guild_id)",
        )
    return project.guild_id


@router.get("/channels", response_model=list[DiscordChannelOut])
async def guild_channels(project_id: int, db: AsyncSession = Depends(get_db)):
    """Каналы и категории сервера — чтобы мастер выбирал из списка, а не вводил ID."""
    guild_id = await _guild_id(project_id, db)
    try:
        return await list_guild_channels(guild_id)
    except DiscordError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get("/members/{user_id}", response_model=DiscordMemberOut)
async def guild_member(project_id: int, user_id: int, db: AsyncSession = Depends(get_db)):
    """Имя и аватар участника по Discord ID (предпросмотр перед привязкой)."""
    guild_id = await _guild_id(project_id, db)
    try:
        return await get_guild_member(guild_id, user_id)
    except DiscordError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get("/roles", response_model=list[DiscordRoleOut])
async def guild_roles(project_id: int, db: AsyncSession = Depends(get_db)):
    """Роли сервера — для выбора роли мастеров и роли игроков в настройках проекта."""
    guild_id = await _guild_id(project_id, db)
    try:
        return await list_guild_roles(guild_id)
    except DiscordError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.post("/channels", response_model=DiscordChannelOut, status_code=status.HTTP_201_CREATED)
async def create_guild_channel(
    project_id: int, body: CreateChannelRequest, db: AsyncSession = Depends(get_db)
):
    """Создать канал в Discord прямо из дашборда.

    Приватный канал закрывается от @everyone и открывается ролям проекта
    (мастера/игроки) и участникам указанной сущности.
    """
    project = await get_project_or_404(project_id, db)
    if not project.guild_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="У проекта не указан Discord server (guild_id)",
        )

    allow_roles = await master_role_ids(project_id, db)
    allow_users: list[int] = []
    entity: Entity | None = None
    if body.entity_id is not None:
        entity = await db.get(Entity, body.entity_id)
        if entity is None or entity.project_id != project_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Сущность не найдена"
            )
        result = await db.execute(
            select(EntityMember.player_id).where(EntityMember.entity_id == entity.id)
        )
        allow_users = [row[0] for row in result.all() if row[0]]

    try:
        created = await create_channel(
            project.guild_id,
            name=body.name,
            channel_type=body.channel_type,
            parent_id=body.parent_id,
            private=body.private,
            allow_role_ids=allow_roles,
            allow_user_ids=allow_users,
        )
    except DiscordError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))

    channel_id = int(created["channel_id"])
    parent = int(created["parent_id"]) if created.get("parent_id") else None

    if body.register_channel:
        db.add(
            ProjectChannel(
                project_id=project_id,
                channel_id=channel_id,
                channel_type=created["type"],
                label=created["name"],
                discord_parent_id=parent,
            )
        )
    if entity is not None:
        db.add(
            EntityChannel(
                entity_id=entity.id,
                discord_channel_id=channel_id,
                label=created["name"],
                sync_access=True,
            )
        )
    await db.commit()

    return DiscordChannelOut(
        channel_id=created["channel_id"],
        name=created["name"],
        type=created["type"],
        position=0,
        parent_id=created.get("parent_id"),
        parent_name=None,
    )


@router.delete("/channels/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_guild_channel(
    project_id: int, channel_id: int, db: AsyncSession = Depends(get_db)
) -> None:
    """Удалить канал в Discord вместе с его регистрацией и привязками.

    Необратимо: канал и его история пропадают на сервере. Вызывается только
    из явного подтверждения на экране каналов.
    """
    await get_project_or_404(project_id, db)
    try:
        await discord_delete_channel(channel_id)
    except DiscordError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))

    # Подчищаем следы удалённого канала, иначе он останется висеть в привязках.
    rows = await db.execute(
        select(ProjectChannel).where(
            ProjectChannel.project_id == project_id, ProjectChannel.channel_id == channel_id
        )
    )
    for row in rows.scalars().all():
        await db.delete(row)

    links = await db.execute(
        select(EntityChannel)
        .join(Entity, Entity.id == EntityChannel.entity_id)
        .where(Entity.project_id == project_id, EntityChannel.discord_channel_id == channel_id)
    )
    for link in links.scalars().all():
        await db.delete(link)
    await db.commit()
