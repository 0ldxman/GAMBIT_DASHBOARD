from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import EntityType
from app.routers.projects import get_project_or_404
from app.schemas import EntityTypeCreate
from app.schemas import EntityTypeOut
from app.schemas import EntityTypeUpdate
from app.schemas import TemplatePreviewRequest
from app.schemas import TemplatePreviewResponse
from app.security import require_master
from app.templating import render_entity_template
from app.templating import validate_template

router = APIRouter(
    prefix="/projects/{project_id}/entity-types",
    tags=["entity-types"],
    dependencies=[Depends(require_master)],
)


async def get_type_or_404(project_id: int, type_id: int, db: AsyncSession) -> EntityType:
    et = await db.get(EntityType, type_id)
    if et is None or et.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Тип не найден")
    return et


@router.get("", response_model=list[EntityTypeOut])
async def list_types(
    project_id: int, db: AsyncSession = Depends(get_db)
) -> list[EntityType]:
    await get_project_or_404(project_id, db)
    result = await db.execute(
        select(EntityType).where(EntityType.project_id == project_id)
    )
    return list(result.scalars().all())


@router.post("", response_model=EntityTypeOut, status_code=status.HTTP_201_CREATED)
async def create_type(
    project_id: int, body: EntityTypeCreate, db: AsyncSession = Depends(get_db)
) -> EntityType:
    await get_project_or_404(project_id, db)
    err = validate_template(body.attributes_template)
    if err:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=err)
    et = EntityType(project_id=project_id, **body.model_dump())
    db.add(et)
    await db.commit()
    await db.refresh(et)
    return et


@router.post("/preview", response_model=TemplatePreviewResponse)
async def preview_template(
    project_id: int, body: TemplatePreviewRequest
) -> TemplatePreviewResponse:
    """Предпросмотр рендера embed-шаблона (для редактора типа)."""
    err = validate_template(body.template)
    if err:
        return TemplatePreviewResponse(rendered="", error=err)
    rendered = render_entity_template(body.template, body.attributes, label=body.label)
    return TemplatePreviewResponse(rendered=rendered)


@router.patch("/{type_id}", response_model=EntityTypeOut)
async def update_type(
    project_id: int, type_id: int, body: EntityTypeUpdate, db: AsyncSession = Depends(get_db)
) -> EntityType:
    et = await get_type_or_404(project_id, type_id, db)
    data = body.model_dump(exclude_unset=True)
    if "attributes_template" in data:
        err = validate_template(data["attributes_template"])
        if err:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=err)
    for field, value in data.items():
        setattr(et, field, value)
    await db.commit()
    await db.refresh(et)
    return et


@router.delete("/{type_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_type(
    project_id: int, type_id: int, db: AsyncSession = Depends(get_db)
) -> None:
    et = await get_type_or_404(project_id, type_id, db)
    await db.delete(et)
    await db.commit()
