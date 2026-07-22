"""Вычисляемые поля типа сущности: формулы от атрибутов.

Мастер описывает поле путём, подписью и выражением:

    {"path": "бюджет.деньги", "label": "Деньги",
     "expr": "казна.прирост - казна.расход"}

Путь — такой же dot-path, как в атрибутах и в правках вердов, поэтому поля
складываются в дерево: `бюджет.деньги` и `бюджет.ресурсы.минералы` окажутся
ветками одного `бюджет`. В шаблоне дерево доступно как `{{ выч.бюджет.деньги }}`
(и просто `{{ бюджет.деньги }}`, если атрибута с таким корнем нет).

Поля могут ссылаться друг на друга (`выч.бюджет.деньги + выч.бюджет.налоги`) —
порядок вычисления определяется по зависимостям, циклы отлавливаются.

Ошибка в одном поле не ломает остальные и не роняет карточку: поле просто
не попадает в дерево, а мастер видит текст ошибки в редакторе типа.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.expressions import ExpressionError
from app.expressions import check
from app.expressions import dependencies
from app.expressions import evaluate

# Имя, под которым дерево формул кладётся в контекст шаблона.
NAMESPACE = "выч"


class Branch(dict):
    """Ветка дерева формул. Обычный dict плюс подписи листьев для `| поля`.

    Листья хранятся плоско и в порядке объявления полей: `{{ выч.бюджет | поля }}`
    печатает и `бюджет.деньги`, и вложенный `бюджет.ресурсы.минералы` одним
    списком — вложенность нужна для доступа, а не для вида карточки.
    """

    def __init__(self) -> None:
        super().__init__()
        self.leaves: list[tuple[str, Any]] = []


class _Cycle(ExpressionError):
    """Формулы ссылаются по кругу. Отдельный класс — чтобы отличать от обычной
    ошибки вычисления: цикл нужно приписать всей цепочке, а не одному полю."""


@dataclass
class ComputedValue:
    """Результат одного поля: либо число, либо текст ошибки."""

    path: str
    label: str
    value: float | int | None = None
    error: str | None = None


def template_extra(tree: dict[str, Any], attributes: dict[str, Any] | None) -> dict[str, Any]:
    """Что добавить в контекст шаблона: дерево `выч` и короткие алиасы корней.

    Алиас ставится только на свободное имя: настоящий атрибут всегда важнее
    формулы, иначе `{{ бюджет }}` незаметно показывал бы не то, что в сущности.
    """
    if not tree:
        return {}
    extra: dict[str, Any] = {NAMESPACE: tree}
    for root, node in tree.items():
        if root not in (attributes or {}):
            extra[root] = node
    return extra


def normalize(raw: Any) -> list[dict[str, str]]:
    """Отфильтровать мусор из JSONB: остаются записи с путём и выражением."""
    if not isinstance(raw, list):
        return []
    fields: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path") or "").strip()
        expr = str(item.get("expr") or "").strip()
        if not path or not expr or path in seen:
            continue
        seen.add(path)
        fields.append({"path": path, "label": str(item.get("label") or "").strip(), "expr": expr})
    return fields


def validate(raw: Any) -> str | None:
    """Проверить формулы перед сохранением. Возвращает текст ошибки или None."""
    fields = normalize(raw)
    for field in fields:
        path = field["path"]
        parts = path.split(".")
        if not all(part.strip() for part in parts):
            return f"Некорректный путь «{path}»"
        if path.startswith(f"{NAMESPACE}."):
            return f"Путь «{path}» начинается с «{NAMESPACE}.» — этот префикс добавится сам"
        # Поле не может быть одновременно листом и веткой: `бюджет` и
        # `бюджет.деньги` пришлось бы класть в одно место дерева.
        for other in fields:
            if other["path"] != path and other["path"].startswith(f"{path}."):
                return f"Поле «{path}» не может быть и значением, и веткой для «{other['path']}»"
        err = check(field["expr"])
        if err:
            return f"Поле «{path}»: {err}"
    try:
        _resolve_all(fields, {}, check_only=True)
    except ExpressionError as exc:
        return str(exc)
    return None


def _dep_targets(dep: str, by_path: dict[str, dict[str, str]], attributes: dict) -> list[str]:
    """Какие поля нужно вычислить, чтобы разыменовать зависимость dep."""
    if dep.startswith(f"{NAMESPACE}."):
        wanted = dep[len(NAMESPACE) + 1 :]
    elif dep.split(".")[0] in attributes:
        # Настоящий атрибут важнее одноимённой формулы — иначе формула молча
        # подменяла бы данные сущности.
        return []
    else:
        wanted = dep
    if wanted in by_path:
        return [wanted]
    # Ссылка на ветку целиком: нужны все её листья.
    return [path for path in by_path if path.startswith(f"{wanted}.")]


def _resolve_all(
    fields: list[dict[str, str]],
    attributes: dict[str, Any],
    *,
    check_only: bool = False,
) -> tuple[dict[str, float | int], dict[str, str]]:
    """Вычислить все поля. Возвращает (значения, ошибки) по путям."""
    by_path = {field["path"]: field for field in fields}
    values: dict[str, float | int] = {}
    errors: dict[str, str] = {}

    def context() -> dict[str, Any]:
        tree = _build_tree(values, by_path)
        ctx: dict[str, Any] = {**attributes, NAMESPACE: tree}
        for root, node in tree.items():
            # Короткая запись без префикса — только если корень не занят атрибутом.
            ctx.setdefault(root, node)
        return ctx

    def resolve(path: str, stack: tuple[str, ...]) -> None:
        if path in values or path in errors:
            return
        if path in stack:
            chain = " → ".join([*stack[stack.index(path) :], path])
            raise _Cycle(f"Формулы ссылаются по кругу: {chain}")
        field = by_path[path]
        for dep in dependencies(field["expr"]):
            for target in _dep_targets(dep, by_path, attributes):
                try:
                    resolve(target, (*stack, path))
                except _Cycle as cycle:
                    if check_only:
                        raise
                    errors[path] = str(cycle)
                    return
                if target in errors:
                    errors[path] = f"Зависит от «{target}»: {errors[target]}"
                    return
        if check_only:
            # Синтаксис уже проверен в validate(); здесь только обход зависимостей
            # ради поиска циклов. Считать нечего: атрибутов при сохранении нет.
            values[path] = 0
            return
        try:
            values[path] = evaluate(field["expr"], context())
        except ExpressionError as exc:
            errors[path] = str(exc)

    for field in fields:
        resolve(field["path"], ())
    return values, errors


def _build_tree(
    values: dict[str, float | int], by_path: dict[str, dict[str, str]]
) -> dict[str, Any]:
    """Собрать дерево веток из вычисленных значений.

    Ветки создаются и для полей с ошибкой — без самого значения. Так соседние
    поля ветки остаются доступны, а `| поля` показывает у сломанного прочерк.
    """
    tree = Branch()
    for path in by_path:
        parts = path.split(".")
        node = tree
        for part in parts[:-1]:
            nxt = node.get(part)
            if not isinstance(nxt, Branch):
                nxt = Branch()
                node[part] = nxt
            node = nxt
        if path in values:
            node[parts[-1]] = values[path]
    return tree


def compute(
    raw: Any, attributes: dict[str, Any] | None
) -> tuple[dict[str, Any], list[ComputedValue]]:
    """Посчитать формулы типа для конкретных атрибутов.

    Возвращает дерево для шаблона и плоский список значений для дашборда.
    """
    fields = normalize(raw)
    if not fields:
        return {}, []
    attributes = attributes or {}
    values, errors = _resolve_all(fields, attributes)
    by_path = {field["path"]: field for field in fields}
    tree = _build_tree(values, by_path)

    items: list[ComputedValue] = []
    for field in fields:
        path, label = field["path"], field["label"] or field["path"].split(".")[-1]
        items.append(
            ComputedValue(
                path=path,
                label=label,
                value=values.get(path),
                error=errors.get(path),
            )
        )
        # Подпись листа видна всем его веткам — так `| поля` печатает ветку
        # целиком, включая вложенные уровни.
        parts = path.split(".")
        node: Any = tree
        for part in parts[:-1]:
            node = node.get(part) if isinstance(node, Branch) else None
            if isinstance(node, Branch):
                node.leaves.append((label, values.get(path)))
    return tree, items
