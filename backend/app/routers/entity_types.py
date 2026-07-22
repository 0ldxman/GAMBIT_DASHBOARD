from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.computed import compute
from app.computed import merge
from app.computed import validate as validate_computed
from app.database import get_db
from app.descriptions import SAMPLE_EXTRAS
from app.descriptions import build_extras
from app.descriptions import entity_extras
from app.models import Entity
from app.models import EntityType
from app.routers.projects import get_project_or_404
from app.schemas import ComputedValueOut
from app.schemas import EntityTypeCreate
from app.schemas import EntityTypeOut
from app.schemas import EntityTypeUpdate
from app.schemas import RenderedPage
from app.schemas import TemplatePagesRequest
from app.schemas import TemplatePagesResponse
from app.security import require_master
from app.templating import PAGE_SOFT_LIMIT
from app.templating import as_colors
from app.templating import format_number
from app.templating import render_pages
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


def _prepare(data: dict) -> dict:
    """Проверить шаблоны и формулы, синхронизировать первую страницу с attributes_template."""
    if data.get("computed") is not None:
        err = validate_computed(data["computed"])
        if err:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Вычисляемые поля: {err}",
            )
    for index, page in enumerate(data.get("description_pages") or [], start=1):
        err = validate_template(page)
        if err:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Страница {index}: {err}",
            )
    if "attributes_template" in data:
        err = validate_template(data["attributes_template"])
        if err:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=err)
    # attributes_template — зеркало первой страницы: на него опирается запасной
    # путь для типов, созданных до появления страниц.
    if data.get("description_pages"):
        data["attributes_template"] = data["description_pages"][0]
    return data


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
    et = EntityType(project_id=project_id, **_prepare(body.model_dump()))
    db.add(et)
    await db.commit()
    await db.refresh(et)
    return et


@router.post("/preview-pages", response_model=TemplatePagesResponse)
async def preview_pages(
    project_id: int, body: TemplatePagesRequest, db: AsyncSession = Depends(get_db)
) -> TemplatePagesResponse:
    """Предпросмотр страниц описания и значений формул.

    Считаем длину ГОТОВОГО текста: в лимит эмбеда упирается он, а не шаблон —
    одна строка `{{ описание }}` может развернуться в тысячи символов.

    Формулы считаются здесь же, на тех же атрибутах: мастеру нужно видеть и
    число в поле, и страницу, куда оно подставилось.

    Особые переменные (игроки, связи) берутся у настоящей сущности, если она
    указана; в редакторе типа сущности нет — там подставляется пример, иначе
    вёрстку со списком союзников не на чем было бы посмотреть.
    """
    fields = merge(
        [field.model_dump() for field in body.computed],
        [field.model_dump() for field in body.computed_own],
    )
    tree, values = compute(fields, body.attributes)
    computed = [
        ComputedValueOut(
            path=item.path,
            label=item.label,
            text="" if item.value is None else format_number(item.value),
            error=item.error,
            source=item.source,
        )
        for item in values
    ]
    for index, page in enumerate(body.pages, start=1):
        err = validate_template(page)
        if err:
            return TemplatePagesResponse(
                pages=[],
                limit=PAGE_SOFT_LIMIT,
                error=f"Страница {index}: {err}",
                computed=computed,
            )
    extras = SAMPLE_EXTRAS
    if body.entity_id is not None:
        entity = await db.get(Entity, body.entity_id)
        if entity is not None and entity.project_id == project_id:
            extras = await entity_extras(entity, db)

    rendered = render_pages(
        body.pages,
        body.attributes,
        label=body.label,
        extra=build_extras(tree, body.attributes, extras),
    )
    colors = as_colors(body.page_colors, len(rendered))
    return TemplatePagesResponse(
        pages=[
            RenderedPage(
                rendered=text,
                length=len(text),
                over_limit=len(text) > PAGE_SOFT_LIMIT,
                color=color,
            )
            for text, color in zip(rendered, colors)
        ],
        limit=PAGE_SOFT_LIMIT,
        computed=computed,
    )


@router.patch("/{type_id}", response_model=EntityTypeOut)
async def update_type(
    project_id: int, type_id: int, body: EntityTypeUpdate, db: AsyncSession = Depends(get_db)
) -> EntityType:
    et = await get_type_or_404(project_id, type_id, db)
    data = _prepare(body.model_dump(exclude_unset=True))
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
