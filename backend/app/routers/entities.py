from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Entity
from app.models import EntityType
from app.models import ProjectEntity
from app.routers.projects import get_project_or_404
from app.schemas import AssignPlayerRequest
from app.schemas import EntityCreate
from app.schemas import EntityOut
from app.schemas import EntityUpdate
from app.schemas import TemplatePreviewResponse
from app.security import require_master
from app.templating import render_entity_template

router = APIRouter(
    prefix="/projects/{project_id}/entities",
    tags=["entities"],
    dependencies=[Depends(require_master)],
)


async def get_entity_or_404(project_id: int, entity_id: int, db: AsyncSession) -> Entity:
    result = await db.execute(
        select(Entity)
        .where(Entity.id == entity_id, Entity.project_id == project_id)
        .options(selectinload(Entity.assignment))
    )
    entity = result.scalar_one_or_none()
    if entity is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сущность не найдена")
    return entity


@router.get("", response_model=list[EntityOut])
async def list_entities(
    project_id: int, db: AsyncSession = Depends(get_db)
) -> list[Entity]:
    await get_project_or_404(project_id, db)
    result = await db.execute(
        select(Entity)
        .where(Entity.project_id == project_id)
        .options(selectinload(Entity.assignment))
        .order_by(Entity.label)
    )
    return list(result.scalars().all())


@router.post("", response_model=EntityOut, status_code=status.HTTP_201_CREATED)
async def create_entity(
    project_id: int, body: EntityCreate, db: AsyncSession = Depends(get_db)
) -> Entity:
    await get_project_or_404(project_id, db)
    entity = Entity(project_id=project_id, **body.model_dump())
    db.add(entity)
    await db.commit()
    return await get_entity_or_404(project_id, entity.id, db)


@router.get("/{entity_id}", response_model=EntityOut)
async def get_entity(
    project_id: int, entity_id: int, db: AsyncSession = Depends(get_db)
) -> Entity:
    return await get_entity_or_404(project_id, entity_id, db)


@router.patch("/{entity_id}", response_model=EntityOut)
async def update_entity(
    project_id: int, entity_id: int, body: EntityUpdate, db: AsyncSession = Depends(get_db)
) -> Entity:
    entity = await get_entity_or_404(project_id, entity_id, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(entity, field, value)
    await db.commit()
    return await get_entity_or_404(project_id, entity_id, db)


@router.delete("/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entity(
    project_id: int, entity_id: int, db: AsyncSession = Depends(get_db)
) -> None:
    entity = await get_entity_or_404(project_id, entity_id, db)
    await db.delete(entity)
    await db.commit()


@router.put("/{entity_id}/assignment", response_model=EntityOut)
async def assign_player(
    project_id: int,
    entity_id: int,
    body: AssignPlayerRequest,
    db: AsyncSession = Depends(get_db),
) -> Entity:
    """Закрепить сущность за игроком (Discord user id) или снять закрепление."""
    entity = await get_entity_or_404(project_id, entity_id, db)
    if entity.assignment is None:
        db.add(ProjectEntity(project_id=project_id, entity_id=entity.id, player_id=body.player_id))
    else:
        entity.assignment.player_id = body.player_id
    await db.commit()
    return await get_entity_or_404(project_id, entity_id, db)


@router.get("/{entity_id}/render", response_model=TemplatePreviewResponse)
async def render_entity(
    project_id: int, entity_id: int, db: AsyncSession = Depends(get_db)
) -> TemplatePreviewResponse:
    """Отрендерить embed сущности по шаблону её типа (для команды /me-info бота)."""
    entity = await get_entity_or_404(project_id, entity_id, db)
    template = ""
    if entity.type_id is not None:
        et = await db.get(EntityType, entity.type_id)
        if et is not None:
            template = et.attributes_template
    rendered = render_entity_template(template, entity.attributes, label=entity.label)
    return TemplatePreviewResponse(rendered=rendered)
