from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import DirectMessage
from app.models import Entity
from app.models import EntityMember
from app.models import Project
from app.models import Registration
from app.models import RegistrationForm
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

# Цвет полосы эмбеда в ЛС: решение видно ещё до чтения текста.
APPROVED_COLOR = "#3BA55D"
REJECTED_COLOR = "#ED4245"


async def get_registration_or_404(project_id: int, reg_id: int, db: AsyncSession) -> Registration:
    reg = await db.get(Registration, reg_id)
    if reg is None or reg.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    return reg


async def _queue_decision(
    reg: Registration, approved: bool, note: str, db: AsyncSession
) -> None:
    """Положить в очередь ЛС решение по заявке.

    В письме — название проекта и формы: игрок мог подать заявки в несколько
    игр, и «вам отказано» без контекста ничего не объясняет.
    """
    project = await db.get(Project, reg.project_id)
    form = await db.get(RegistrationForm, reg.form_id)
    where = f"«{project.label}»" if project else "проект"
    what = f"«{form.title}»" if form else "заявка"

    lines = [
        f"Заявка {what} в {where} "
        + ("**одобрена**." if approved else "**отклонена**.")
    ]
    if note.strip():
        lines.append("")
        lines.append(("Комментарий мастера" if approved else "Причина") + f": {note.strip()}")

    db.add(
        DirectMessage(
            project_id=reg.project_id,
            player_id=reg.discord_user_id,
            title="Заявка одобрена" if approved else "Заявка отклонена",
            body="\n".join(lines),
            color=APPROVED_COLOR if approved else REJECTED_COLOR,
        )
    )


@router.get("", response_model=list[RegistrationOut])
async def list_registrations(
    project_id: int,
    status_filter: Optional[RegistrationStatus] = Query(default=None, alias="status"),
    form_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> list[Registration]:
    await get_project_or_404(project_id, db)
    query = select(Registration).where(Registration.project_id == project_id)
    if status_filter is not None:
        query = query.where(Registration.status == status_filter)
    if form_id is not None:
        query = query.where(Registration.form_id == form_id)
    query = query.order_by(Registration.created_at.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


@router.post("/{reg_id}/approve", response_model=RegistrationOut)
async def approve_registration(
    project_id: int,
    reg_id: int,
    body: RegistrationReview = RegistrationReview(),
    db: AsyncSession = Depends(get_db),
) -> Registration:
    """Одобрить заявку.

    Сущность здесь НЕ создаётся: анкета редко совпадает с тем, что должно
    оказаться в атрибутах, и автосозданная пустышка потом всё равно правится
    руками. Готовую сущность можно указать — игрок станет её участником.
    """
    reg = await get_registration_or_404(project_id, reg_id, db)
    if reg.status != RegistrationStatus.pending:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Заявка уже рассмотрена")

    if body.entity_id is not None:
        entity = await db.get(Entity, body.entity_id)
        if entity is None or entity.project_id != project_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Сущность не найдена"
            )
        existing = await db.execute(
            select(EntityMember).where(
                EntityMember.entity_id == entity.id,
                EntityMember.player_id == reg.discord_user_id,
            )
        )
        if existing.scalar_one_or_none() is None:
            members = await db.execute(
                select(EntityMember).where(EntityMember.entity_id == entity.id)
            )
            db.add(
                EntityMember(
                    entity_id=entity.id,
                    player_id=reg.discord_user_id,
                    # Первый игрок сущности становится основным: без него
                    # некому отвечать за неё в целом.
                    is_primary=members.scalars().first() is None,
                    player_name=reg.discord_username,
                )
            )
        reg.entity_id = entity.id

    reg.status = RegistrationStatus.approved
    reg.review_note = body.note
    reg.reviewed_by = "master"
    reg.reviewed_at = datetime.now(timezone.utc)
    if body.notify:
        await _queue_decision(reg, True, body.note, db)
    await db.commit()
    await db.refresh(reg)
    return reg


@router.post("/{reg_id}/reject", response_model=RegistrationOut)
async def reject_registration(
    project_id: int,
    reg_id: int,
    body: RegistrationReview = RegistrationReview(),
    db: AsyncSession = Depends(get_db),
) -> Registration:
    reg = await get_registration_or_404(project_id, reg_id, db)
    if reg.status != RegistrationStatus.pending:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Заявка уже рассмотрена")
    reg.status = RegistrationStatus.rejected
    reg.review_note = body.note
    reg.reviewed_by = "master"
    reg.reviewed_at = datetime.now(timezone.utc)
    if body.notify:
        await _queue_decision(reg, False, body.note, db)
    await db.commit()
    await db.refresh(reg)
    return reg
