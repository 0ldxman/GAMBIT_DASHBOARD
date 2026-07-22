"""Описание сущности: страницы типа либо особые страницы самой сущности.

Тип задаёт общий вид карточки для всех своих сущностей. Но иногда одной стране
нужна карточка, не похожая на остальные — тогда мастер включает ей особое
описание, и оно ЗАМЕЩАЕТ шаблон типа целиком (а не дополняет его).

Вычисляемые поля берутся у типа в любом случае: особое описание меняет вид
карточки, а не правила расчёта бюджета.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.computed import ComputedValue
from app.computed import compute
from app.computed import template_extra
from app.models import Entity
from app.models import EntityType
from app.templating import as_pages
from app.templating import render_pages


async def _entity_type(entity: Entity, db: AsyncSession) -> EntityType | None:
    if entity.type_id is None:
        return None
    return await db.get(EntityType, entity.type_id)


async def description_pages(entity: Entity, db: AsyncSession) -> list[str]:
    """Шаблоны страниц, актуальные для сущности (без подстановки значений)."""
    if entity.use_custom_description:
        return as_pages(entity.description_pages)
    entity_type = await _entity_type(entity, db)
    if entity_type is None:
        return []
    return as_pages(entity_type.description_pages, entity_type.attributes_template)


async def entity_computed(
    entity: Entity, db: AsyncSession
) -> tuple[dict[str, Any], list[ComputedValue]]:
    """Посчитать формулы типа на атрибутах сущности."""
    entity_type = await _entity_type(entity, db)
    return compute(entity_type.computed if entity_type else [], entity.attributes)


async def render_entity_pages(entity: Entity, db: AsyncSession) -> list[str]:
    """Готовые тексты страниц: в Discord игрок листает их кнопками."""
    pages = await description_pages(entity, db)
    tree, _ = await entity_computed(entity, db)
    return render_pages(
        pages,
        entity.attributes,
        label=entity.label,
        extra=template_extra(tree, entity.attributes),
    )
