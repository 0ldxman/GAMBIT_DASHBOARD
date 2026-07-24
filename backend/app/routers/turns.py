"""Ход игры: предпросмотр автоизменений, завершение хода и откат.

Завершение хода необратимо меняет атрибуты всех сущностей, поэтому:
  * `preview` показывает «было → станет» по всему проекту до применения;
  * `end` защищён `expected_turn` от повторного клика и сохраняет снимок;
  * `rollback` возвращает состояние из последнего снимка.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Entity
from app.models import TurnSnapshot
from app.routers.projects import get_project_or_404
from app.schemas import EditPreviewOut
from app.schemas import EditPreviewRow
from app.schemas import TurnEndRequest
from app.schemas import TurnPreviewOut
from app.schemas import TurnStateOut
from app.security import require_master
from app.turn_engine import compute_turn

router = APIRouter(
    prefix="/projects/{project_id}/turn",
    tags=["turn"],
    dependencies=[Depends(require_master)],
)


async def _latest_snapshot(project_id: int, db: AsyncSession) -> TurnSnapshot | None:
    result = await db.execute(
        select(TurnSnapshot)
        .where(TurnSnapshot.project_id == project_id)
        .order_by(TurnSnapshot.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


@router.get("/state", response_model=TurnStateOut)
async def turn_state(project_id: int, db: AsyncSession = Depends(get_db)) -> TurnStateOut:
    project = await get_project_or_404(project_id, db)
    snapshot = await _latest_snapshot(project_id, db)
    return TurnStateOut(turn_number=project.turn_number, can_rollback=snapshot is not None)


@router.post("/preview", response_model=TurnPreviewOut)
async def preview_turn(project_id: int, db: AsyncSession = Depends(get_db)) -> TurnPreviewOut:
    """Что автоизменения сделают со всеми сущностями, если завершить ход сейчас."""
    project = await get_project_or_404(project_id, db)
    results = await compute_turn(project_id, db)
    entities = [
        EditPreviewOut(
            entity_id=r.entity.id,
            label=r.entity.label,
            rows=[EditPreviewRow(**row) for row in r.rows],
        )
        for r in results
    ]
    has_errors = any(r.errors for r in results)
    return TurnPreviewOut(
        turn_number=project.turn_number, entities=entities, has_errors=has_errors
    )


@router.post("/end", response_model=TurnStateOut)
async def end_turn(
    project_id: int, body: TurnEndRequest, db: AsyncSession = Depends(get_db)
) -> TurnStateOut:
    """Применить автоизменения ко всем сущностям и повысить номер хода.

    Расчёт одновременный: сначала считаем дельты всех сущностей по состоянию на
    начало хода, потом пишем вместе. Перед записью сохраняем снимок для отката.
    """
    project = await get_project_or_404(project_id, db)
    if body.expected_turn != project.turn_number:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Ход уже {project.turn_number}, а вы завершаете {body.expected_turn}. "
                "Обновите страницу — возможно, ход завершил кто-то ещё."
            ),
        )

    results = await compute_turn(project_id, db)
    for r in results:
        if r.errors:
            path, message = next(iter(r.errors.items()))
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"«{r.entity.label}» → {path}: {message}",
            )

    # Снимок держим один — откат на один ход. Предыдущий больше не нужен.
    await db.execute(delete(TurnSnapshot).where(TurnSnapshot.project_id == project_id))
    snapshot = TurnSnapshot(
        project_id=project_id,
        turn_number=project.turn_number,
        data={str(r.entity.id): r.before for r in results},
    )
    db.add(snapshot)

    for r in results:
        r.entity.attributes = r.after
    project.turn_number += 1

    await db.commit()
    return TurnStateOut(turn_number=project.turn_number, can_rollback=True)


@router.post("/rollback", response_model=TurnStateOut)
async def rollback_turn(project_id: int, db: AsyncSession = Depends(get_db)) -> TurnStateOut:
    """Вернуть атрибуты из последнего снимка и понизить номер хода."""
    project = await get_project_or_404(project_id, db)
    snapshot = await _latest_snapshot(project_id, db)
    if snapshot is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Нет снимка предыдущего хода — откатывать нечего.",
        )

    ids = [int(eid) for eid in snapshot.data]
    entities = (
        (await db.execute(select(Entity).where(Entity.id.in_(ids)))).scalars().all()
        if ids
        else []
    )
    for entity in entities:
        # Сущности, удалённые после снимка, просто пропускаются.
        if entity.project_id == project_id:
            entity.attributes = snapshot.data.get(str(entity.id), entity.attributes)

    project.turn_number = snapshot.turn_number
    await db.delete(snapshot)
    await db.commit()
    remaining = await _latest_snapshot(project_id, db)
    return TurnStateOut(turn_number=project.turn_number, can_rollback=remaining is not None)
