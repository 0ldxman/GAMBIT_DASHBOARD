"""Описание сущности: страницы типа либо особые страницы самой сущности.

Тип задаёт общий вид карточки для всех своих сущностей. Но иногда одной стране
нужна карточка, не похожая на остальные — тогда мастер включает ей особое
описание, и оно ЗАМЕЩАЕТ шаблон типа целиком (а не дополняет его).

Вычисляемые поля берутся у типа в любом случае: особое описание меняет вид
карточки, а не правила расчёта бюджета. К типовым формулам добавляются
собственные формулы сущности — они дополняют список, а совпадение путей
переопределяет одну формулу (см. app/computed.merge).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import or_
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.computed import ComputedValue
from app.computed import compute
from app.computed import merge
from app.computed import template_extra
from app.models import Entity
from app.models import EntityMember
from app.models import EntityRelation
from app.models import EntityType
from app.templating import as_colors
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


async def description_colors(entity: Entity, db: AsyncSession, count: int) -> list[str]:
    """Цвета страниц из того же источника, что и сами страницы."""
    if entity.use_custom_description:
        return as_colors(entity.page_colors, count)
    entity_type = await _entity_type(entity, db)
    return as_colors(entity_type.page_colors if entity_type else [], count)


async def entity_fields(entity: Entity, db: AsyncSession) -> list[dict[str, str]]:
    """Формулы, действующие для сущности: типовые, поверх них — собственные."""
    entity_type = await _entity_type(entity, db)
    return merge(entity_type.computed if entity_type else [], entity.computed)


async def entity_computed(
    entity: Entity, db: AsyncSession
) -> tuple[dict[str, Any], list[ComputedValue]]:
    """Посчитать формулы сущности на её же атрибутах."""
    return compute(await entity_fields(entity, db), entity.attributes)


async def entity_extras(entity: Entity, db: AsyncSession) -> dict[str, Any]:
    """Особые переменные шаблона: не атрибуты, а связи сущности с миром.

    Всё это списки словарей, поэтому печатаются теми же фильтрами, что и
    атрибуты-списки:

        Лидер: {{ лидер }}
        {{ игроки | строки("{имя} — {роль}") }}
        Союзники: {{ связи.союзник | строки("{название}") }}
        Входит в: {{ родители | строки("{название} ({тип})") }}

    `родители` и `дети` — только иерархические связи. Взаимные («союзник»,
    «война») иерархии не образуют и живут исключительно в `связи` по своему
    типу, зато видны с обеих сторон.
    """
    members = (
        await db.execute(
            select(EntityMember)
            .where(EntityMember.entity_id == entity.id)
            .order_by(EntityMember.is_primary.desc(), EntityMember.role)
        )
    ).scalars().all()

    relations = (
        await db.execute(
            select(EntityRelation).where(
                or_(
                    EntityRelation.parent_id == entity.id,
                    EntityRelation.child_id == entity.id,
                )
            )
        )
    ).scalars().all()

    # Названия вторых сторон одним запросом: связей у крупной страны десятки.
    other_ids = {
        relation.child_id if relation.parent_id == entity.id else relation.parent_id
        for relation in relations
    }
    names: dict[int, str] = {}
    if other_ids:
        rows = await db.execute(select(Entity.id, Entity.label).where(Entity.id.in_(other_ids)))
        names = {row.id: row.label for row in rows}

    parents: list[dict[str, Any]] = []
    children: list[dict[str, Any]] = []
    by_type: dict[str, list[dict[str, Any]]] = {}
    for relation in relations:
        parent_side = relation.parent_id == entity.id
        other_id = relation.child_id if parent_side else relation.parent_id
        item = {
            "название": names.get(other_id, ""),
            "тип": relation.relation_type,
            "направление": ("дочерняя" if parent_side else "родитель")
            if relation.directed
            else "взаимная",
            "id": other_id,
        }
        if relation.directed:
            (children if parent_side else parents).append(item)
        # По типу связи собираем ОБЕ стороны: «союзник» симметричен, и мастеру
        # нужен список союзников, а не только тех, кого он вписал первым.
        by_type.setdefault(relation.relation_type, []).append(item)

    entity_type = await _entity_type(entity, db)
    return {
        "игроки": [
            {
                "имя": member.player_name or str(member.player_id),
                "роль": member.role,
                "основной": member.is_primary,
                "id": member.player_id,
            }
            for member in members
        ],
        "лидер": next(
            (m.player_name or str(m.player_id) for m in members if m.is_primary),
            "",
        ),
        "родители": parents,
        "дети": children,
        "связи": by_type,
        "тип": entity_type.label if entity_type else "",
    }


# Имя, под которым особые переменные всегда доступны целиком.
EXTRAS_NAMESPACE = "сущность"

# Чем наполнить предпросмотр в редакторе ТИПА: настоящей сущности там нет, а
# увидеть, как ляжет вёрстка со списком игроков и союзников, нужно.
SAMPLE_EXTRAS: dict[str, Any] = {
    "игроки": [
        {"имя": "Игрок", "роль": "лидер", "основной": True, "id": 0},
        {"имя": "Второй игрок", "роль": "глава МИД", "основной": False, "id": 0},
    ],
    "лидер": "Игрок",
    "родители": [
        {"название": "Организация", "тип": "член организации", "направление": "родитель", "id": 0}
    ],
    "дети": [{"название": "Провинция", "тип": "состав", "направление": "дочерняя", "id": 0}],
    "связи": {
        "союзник": [
            {"название": "Соседняя страна", "тип": "союзник", "направление": "взаимная", "id": 0}
        ],
        "война": [
            {"название": "Дальняя страна", "тип": "война", "направление": "взаимная", "id": 0}
        ],
        "состав": [{"название": "Провинция", "тип": "состав", "направление": "дочерняя", "id": 0}],
    },
    "тип": "Тип сущности",
}


def build_extras(
    tree: dict[str, Any], attributes: dict[str, Any] | None, extras: dict[str, Any]
) -> dict[str, Any]:
    """Собрать всё, что кладётся в шаблон помимо самих атрибутов.

    Короткое имя (`{{ игроки }}`) ставится только на свободное: настоящий
    атрибут всегда важнее — то же правило, что и у формул. Полный доступ есть
    всегда через `{{ сущность.игроки }}`.
    """
    context: dict[str, Any] = {
        **template_extra(tree, attributes),
        EXTRAS_NAMESPACE: extras,
    }
    for key, value in extras.items():
        if key not in (attributes or {}):
            context[key] = value
    return context


async def render_entity_pages(entity: Entity, db: AsyncSession) -> list[str]:
    """Готовые тексты страниц: в Discord игрок листает их кнопками."""
    pages = await description_pages(entity, db)
    tree, _ = await entity_computed(entity, db)
    extra = build_extras(tree, entity.attributes, await entity_extras(entity, db))
    return render_pages(pages, entity.attributes, label=entity.label, extra=extra)


async def render_entity_card(entity: Entity, db: AsyncSession) -> tuple[list[str], list[str]]:
    """Страницы карточки вместе с цветом каждой — то, что уходит в Discord."""
    rendered = await render_entity_pages(entity, db)
    return rendered, await description_colors(entity, db, len(rendered))
