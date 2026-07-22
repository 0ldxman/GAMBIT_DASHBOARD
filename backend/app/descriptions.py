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


def _related_card(entity: Entity, entity_type: EntityType | None) -> dict[str, Any]:
    """Вторая сторона связи так, как её видно из шаблона.

    Кроме названия отдаются её атрибуты и посчитанные формулы — тогда список
    структур страны пишется одной строкой:

        {{ связи.принадлежит | строки("{название} — {описание}") }}

    Короткое имя атрибута ставится только на свободное: имена самой связи
    (`название`, `тип`, `направление`, `id`) важнее — то же правило, что и у
    формул. Полный доступ есть всегда: `{атрибуты.описание}` и `{выч.мощь}`.
    """
    attributes = entity.attributes if isinstance(entity.attributes, dict) else {}
    tree, _ = compute(
        merge(entity_type.computed if entity_type else [], entity.computed), attributes
    )
    card: dict[str, Any] = dict(attributes)
    card.update(template_extra(tree, attributes))
    card.update(
        {
            "название": entity.label,
            "тип_сущности": entity_type.label if entity_type else "",
            "атрибуты": attributes,
            "id": entity.id,
        }
    )
    return card


async def _related_cards(ids: set[int], db: AsyncSession) -> dict[int, dict[str, Any]]:
    """Карточки вторых сторон: сущности и их типы двумя запросами на всех."""
    if not ids:
        return {}
    others = list(
        (await db.execute(select(Entity).where(Entity.id.in_(ids)))).scalars().all()
    )
    type_ids = {other.type_id for other in others if other.type_id is not None}
    types: dict[int, EntityType] = {}
    if type_ids:
        rows = await db.execute(select(EntityType).where(EntityType.id.in_(type_ids)))
        types = {entity_type.id: entity_type for entity_type in rows.scalars()}
    # Одна и та же сущность встречается в нескольких связях — считаем её раз.
    return {
        other.id: _related_card(other, types.get(other.type_id) if other.type_id else None)
        for other in others
    }


async def entity_extras(entity: Entity, db: AsyncSession) -> dict[str, Any]:
    """Особые переменные шаблона: не атрибуты, а связи сущности с миром.

    Всё это списки словарей, поэтому печатаются теми же фильтрами, что и
    атрибуты-списки:

        Лидер: {{ лидер }}
        {{ игроки | строки("{имя} — {роль}") }}
        Союзники: {{ связи.союзник | строки("{название}") }}
        Входит в: {{ родители | строки("{название} ({тип})") }}
        Структуры: {{ связи.принадлежит | строки("{название} — {описание}") }}

    `родители` и `дети` — только иерархические связи. Взаимные («союзник»,
    «война») иерархии не образуют и живут исключительно в `связи` по своему
    типу, зато видны с обеих сторон.

    В элементе связи лежит не одно название, а вся вторая сторона — её
    атрибуты и формулы (см. `_related_card`).
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

    # Вторые стороны одним запросом: связей у крупной страны десятки. Берутся
    # целиком, а не одними названиями — из них показываются поля.
    other_ids = {
        relation.child_id if relation.parent_id == entity.id else relation.parent_id
        for relation in relations
    }
    cards = await _related_cards(other_ids, db)

    parents: list[dict[str, Any]] = []
    children: list[dict[str, Any]] = []
    by_type: dict[str, list[dict[str, Any]]] = {}
    for relation in relations:
        parent_side = relation.parent_id == entity.id
        other_id = relation.child_id if parent_side else relation.parent_id
        item = {
            **cards.get(other_id, {"название": "", "атрибуты": {}, "id": other_id}),
            # Имена самой связи ставятся последними: в элементе списка «тип» —
            # это вид связи, а не тип второй стороны (он в «тип_сущности»).
            "тип": relation.relation_type,
            "направление": ("дочерняя" if parent_side else "родитель")
            if relation.directed
            else "взаимная",
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

def _sample_side(name: str, kind: str, relation: str, direction: str, **attrs: Any) -> dict:
    """Вторая сторона для примера — с полями, как у настоящей."""
    return {
        **attrs,
        "название": name,
        "тип_сущности": kind,
        "атрибуты": dict(attrs),
        "тип": relation,
        "направление": direction,
        "id": 0,
    }


# Чем наполнить предпросмотр в редакторе ТИПА: настоящей сущности там нет, а
# увидеть, как ляжет вёрстка со списком игроков и союзников, нужно.
SAMPLE_EXTRAS: dict[str, Any] = {
    "игроки": [
        {"имя": "Игрок", "роль": "лидер", "основной": True, "id": 0},
        {"имя": "Второй игрок", "роль": "глава МИД", "основной": False, "id": 0},
    ],
    "лидер": "Игрок",
    "родители": [
        _sample_side("Организация", "Блок", "член организации", "родитель", основана=1949)
    ],
    "дети": [_sample_side("Провинция", "Регион", "состав", "дочерняя", население=120000)],
    "связи": {
        "союзник": [
            _sample_side("Соседняя страна", "Страна", "союзник", "взаимная", столица="Город")
        ],
        "война": [
            _sample_side("Дальняя страна", "Страна", "война", "взаимная", столица="Другой город")
        ],
        "состав": [_sample_side("Провинция", "Регион", "состав", "дочерняя", население=120000)],
        "принадлежит": [
            _sample_side(
                "Структура",
                "Структура",
                "принадлежит",
                "взаимная",
                описание="что это и зачем",
            )
        ],
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
