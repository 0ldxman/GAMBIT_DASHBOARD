"""Описание сущности: страницы типа либо особые страницы самой сущности.

Тип задаёт общий вид карточки для всех своих сущностей. Но иногда одной стране
нужна карточка, не похожая на остальные — тогда мастер включает ей особое
описание, и оно ЗАМЕЩАЕТ шаблон типа целиком (а не дополняет его).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Entity
from app.models import EntityType
from app.templating import as_pages
from app.templating import render_pages


async def description_pages(entity: Entity, db: AsyncSession) -> list[str]:
    """Шаблоны страниц, актуальные для сущности (без подстановки значений)."""
    if entity.use_custom_description:
        return as_pages(entity.description_pages)
    if entity.type_id is None:
        return []
    entity_type = await db.get(EntityType, entity.type_id)
    if entity_type is None:
        return []
    return as_pages(entity_type.description_pages, entity_type.attributes_template)


async def render_entity_pages(entity: Entity, db: AsyncSession) -> list[str]:
    """Готовые тексты страниц: каждая уходит в Discord отдельным эмбедом."""
    pages = await description_pages(entity, db)
    return render_pages(pages, entity.attributes, label=entity.label)
