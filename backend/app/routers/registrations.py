from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Entity
from app.models import EntityMember
from app.models import Registration
from app.models import RegistrationStatus
from app.routers.projects import get_project_or_404
from app.schemas import RegistrationOut
from app.schemas import RegistrationReview
from app.security import require_master
from datetime import datetime
from datetime import timezone
from typing import Optional

router = APIRouter(
    prefix="/projects/{project_id}/registrations",
    tags=["registrations"],
    dependencies=[Depends(require_master)],
)


async def get_registration_or_404(project_id: int, reg_id: int, db: AsyncSession) -> Registration:
    reg = await db.get(Registration, reg_id)
    if reg is None or reg.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    return reg


@router.get("", response_model=list[RegistrationOut])
async def list_registrations(
    project_id: int,
    status_filter: Optional[RegistrationStatus] = Query(default=None, alias="status"),
    db: AsyncSession = Depends(get_db),
) -> list[Registration]:
    await get_project_or_404(project_id, db)
    query = select(Registration).where(Registration.project_id == project_id)
    if status_filter is not None:
        query = query.where(Registration.status == status_filter)
    query = query.order_by(Registration.created_at.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


@router.post("/{reg_id}/approve", response_model=RegistrationOut)
async def approve_registration(
    project_id: int,
    reg_id: int,
    body: RegistrationReview,
    db: AsyncSession = Depends(get_db),
) -> Registration:
    reg = await get_registration_or_404(project_id, reg_id, db)
    if reg.status != RegistrationStatus.pending:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Заявка уже рассмотрена")

    if body.create_entity:
        entity = Entity(
            project_id=project_id,
            label=body.entity_label or reg.discord_username or f"Игрок {reg.discord_user_id}",
            type_id=body.entity_type_id,
            attributes=reg.answers,
        )
        db.add(entity)
        await db.flush()  # получить entity.id
        db.add(
            EntityMember(
                entity_id=entity.id,
                player_id=reg.discord_user_id,
                is_primary=True,
                player_name=reg.discord_username,
            )
        )
        reg.entity_id = entity.id

    reg.status = RegistrationStatus.approved
    reg.reviewed_by = "master"
    reg.reviewed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(reg)
    return reg


@router.post("/{reg_id}/reject", response_model=RegistrationOut)
async def reject_registration(
    project_id: int, reg_id: int, db: AsyncSession = Depends(get_db)
) -> Registration:
    reg = await get_registration_or_404(project_id, reg_id, db)
    if reg.status != RegistrationStatus.pending:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Заявка уже рассмотрена")
    reg.status = RegistrationStatus.rejected
    reg.reviewed_by = "master"
    reg.reviewed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(reg)
    return reg
