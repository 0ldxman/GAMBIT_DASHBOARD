"""Справочники из Discord для дашборда: список каналов сервера, профиль участника."""

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.discord_api import DiscordError
from app.discord_api import get_guild_member
from app.discord_api import list_guild_channels
from app.routers.projects import get_project_or_404
from app.schemas import DiscordChannelOut
from app.schemas import DiscordMemberOut
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
