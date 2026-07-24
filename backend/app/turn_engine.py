"""Ход игры: одновременный расчёт автоизменений и снимки для отката.

Правило хода — это «атрибут ← выражение», применяемое к сущности при завершении
хода. Технически это та же операция `expr`, что и в правках верда, поэтому расчёт
опирается на готовый `run_edit_ops`: он даёт последовательность правил ВНУТРИ
сущности (правило видит результат предыдущего своего же) и ту же защиту от записи
внутрь списка.

Одновременность МЕЖДУ сущностями обеспечивается порядком: сначала считаем дельты
всех сущностей, и только потом пишем. Пока ничего не записано, соседи в `связи.*`
видны в состоянии на начало хода — «мощь союзника до того, как он её потратил».
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import computed
from app.descriptions import entity_extras
from app.expressions import check
from app.models import Entity
from app.models import EntityType
from app.routers.posts import _at_path
from app.routers.posts import _show
from app.routers.posts import run_edit_ops


def validate_turn_rules(raw: Any) -> str | None:
    """Проверить правила хода перед сохранением. Текст ошибки или None."""
    for field in computed.normalize(raw):
        path = field["path"]
        if not all(part.strip() for part in path.split(".")):
            return f"Некорректный путь «{path}»"
        if path.startswith(f"{computed.NAMESPACE}."):
            return (
                f"Правило пишет в атрибут, а «{path}» — вычисляемое поле, "
                "оно только для чтения"
            )
        err = check(field["expr"])
        if err:
            return f"Правило «{path}»: {err}"
    return None


class TurnResult:
    """Итог расчёта хода по одной сущности (без применения)."""

    def __init__(self, entity: Entity, before: dict, after: dict, rows: list, errors: dict):
        self.entity = entity
        self.before = before
        self.after = after
        self.rows = rows
        self.errors = errors


async def compute_turn(project_id: int, db: AsyncSession) -> list[TurnResult]:
    """Посчитать автоизменения всех сущностей по состоянию НА НАЧАЛО хода.

    Ничего не пишет — и предпросмотр, и завершение хода используют этот расчёт,
    отличаясь лишь тем, применяются ли результаты. Пока результаты только
    считаются (никто не записан), соседи заморожены — это и есть одновременность.
    """
    entities = list(
        (await db.execute(select(Entity).where(Entity.project_id == project_id)))
        .scalars()
        .all()
    )
    type_ids = {e.type_id for e in entities if e.type_id is not None}
    types: dict[int, EntityType] = {}
    if type_ids:
        rows = await db.execute(select(EntityType).where(EntityType.id.in_(type_ids)))
        types = {et.id: et for et in rows.scalars()}

    results: list[TurnResult] = []
    for entity in entities:
        et = types.get(entity.type_id) if entity.type_id is not None else None
        merged_rules = computed.merge(et.turn_rules if et else [], entity.turn_rules)
        if not merged_rules:
            continue
        fields = computed.merge(et.computed if et else [], entity.computed)
        ops = [
            {"path": rule["path"], "mode": "expr", "value": rule["expr"]}
            for rule in merged_rules
        ]
        # Соседи — из текущих (ещё не изменённых) атрибутов: пока не записали
        # ничего, состояние всех сущностей = начало хода.
        extras = await entity_extras(entity, db)
        before = dict(entity.attributes or {})
        after, errors = run_edit_ops(before, fields, ops, {}, extras)

        preview_rows = []
        for op in ops:
            path = op["path"]
            was, now = _at_path(before, path), _at_path(after, path)
            preview_rows.append(
                {
                    "path": path,
                    "before": _show(was),
                    "after": _show(now),
                    "changed": was != now,
                    "error": errors.get(path),
                }
            )
        results.append(TurnResult(entity, before, after, preview_rows, errors))
    return results
