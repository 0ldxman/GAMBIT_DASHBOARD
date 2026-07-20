from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import ProjectChannel
from app.routers.projects import get_project_or_404
from app.schemas import ChannelCreate
from app.schemas import ChannelOut
from app.schemas import ChannelUpdate
from app.security import require_master

router = APIRouter(
    prefix="/projects/{project_id}/channels",
    tags=["channels"],
    dependencies=[Depends(require_master)],
)


async def get_channel_or_404(
    project_id: int, channel_pk: int, db: AsyncSession
) -> ProjectChannel:
    channel = await db.get(ProjectChannel, channel_pk)
    if channel is None or channel.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Канал не найден")
    return channel


@router.get("", response_model=list[ChannelOut])
async def list_channels(
    project_id: int, db: AsyncSession = Depends(get_db)
) -> list[ProjectChannel]:
    await get_project_or_404(project_id, db)
    result = await db.execute(
        select(ProjectChannel).where(ProjectChannel.project_id == project_id)
    )
    return list(result.scalars().all())


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
