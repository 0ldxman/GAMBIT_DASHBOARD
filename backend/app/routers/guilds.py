"""Серверы, на которых стоит бот.

Мастер начинает с выбора сервера, а не с ручного ввода guild_id: дашборд
спрашивает у Discord список серверов бота и его каналы/роли ещё до того,
как проект создан.
"""

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.discord_api import DiscordError
from app.models import Project
from app.discord_api import list_bot_guilds
from app.discord_api import list_guild_channels
from app.discord_api import list_guild_roles
from app.schemas import DiscordChannelOut
from app.schemas import DiscordGuildOut
from app.schemas import DiscordRoleOut
from app.security import require_master

router = APIRouter(prefix="/guilds", tags=["guilds"], dependencies=[Depends(require_master)])


def _bad_gateway(exc: DiscordError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get("", response_model=list[DiscordGuildOut])
async def bot_guilds(db: AsyncSession = Depends(get_db)):
    try:
        guilds = await list_bot_guilds()
    except DiscordError as exc:
        raise _bad_gateway(exc)

    # Сколько проектов заведено на каждом сервере — для карточки.
    result = await db.execute(
        select(Project.guild_id, func.count()).group_by(Project.guild_id)
    )
    counts = {str(gid): n for gid, n in result.all() if gid}
    for g in guilds:
        g["project_count"] = counts.get(g["guild_id"], 0)
    return guilds


@router.get("/{guild_id}/channels", response_model=list[DiscordChannelOut])
async def guild_channels(guild_id: int):
    try:
        return await list_guild_channels(guild_id)
    except DiscordError as exc:
        raise _bad_gateway(exc)


@router.get("/{guild_id}/roles", response_model=list[DiscordRoleOut])
async def guild_roles(guild_id: int):
    try:
        return await list_guild_roles(guild_id)
    except DiscordError as exc:
        raise _bad_gateway(exc)
