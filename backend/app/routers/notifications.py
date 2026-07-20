from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Notification
from app.routers.projects import get_project_or_404
from app.schemas import NotificationOut
from app.security import require_master

router = APIRouter(
    prefix="/projects/{project_id}/notifications",
    tags=["notifications"],
    dependencies=[Depends(require_master)],
)


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    project_id: int,
    unread_only: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
) -> list[Notification]:
    await get_project_or_404(project_id, db)
    query = select(Notification).where(Notification.project_id == project_id)
    if unread_only:
        query = query.where(Notification.is_read.is_(False))
    query = query.order_by(Notification.created_at.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_read(
    project_id: int, notification_id: int, db: AsyncSession = Depends(get_db)
) -> Notification:
    note = await db.get(Notification, notification_id)
    if note is None or note.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Уведомление не найдено")
    note.is_read = True
    await db.commit()
    await db.refresh(note)
    return note


@router.post("/read-all")
async def mark_all_read(project_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    await get_project_or_404(project_id, db)
    result = await db.execute(
        select(Notification).where(
            Notification.project_id == project_id, Notification.is_read.is_(False)
        )
    )
    for note in result.scalars().all():
        note.is_read = True
    await db.commit()
    return {"status": "ok"}
