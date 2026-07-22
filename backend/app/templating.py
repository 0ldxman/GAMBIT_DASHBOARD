"""Рендер embed-шаблонов типов сущностей (Jinja2, с поддержкой кириллицы).

Шаблон пишется мастером в EntityType.attributes_template, значения берутся из
Entity.attributes. Пример шаблона:

    **{{ label }}**
    Столица: {{ столица }}
    Население: {{ население }}
    Армия: {{ attrs['военная сила'] }}

Кириллические имена-идентификаторы (`{{ столица }}`) работают напрямую.
Ключи с пробелами/спецсимволами — через `{{ attrs['...'] }}`.

Вычисляемые поля типа (app/computed.py) приходят в контекст деревом `выч`:

    Бюджет: {{ выч.бюджет.итого | со_знаком }}   → Бюджет: +12 320
    {{ выч.бюджет | поля }}                      → Деньги: 12 400
                                                   Минералы: -80

Атрибут-список печатается через запятую сам, а фильтры дают другие виды:

    {{ духи }}                                   → Милитаризм, Изоляционизм
    {{ духи | список }}                          → • Милитаризм
                                                   • Изоляционизм
    {{ духи | нумерованный }}                    → 1. Милитаризм
    {{ союзники | через_запятую(пусто="нет") }}  → нет
    {{ духи | сколько }}                         → 2
    {{ флот | строки("{имя} — {тоннаж}") }}      → Балтийский — 84 300

Полный Jinja2 тоже доступен: `{% for %}`, `join`, `sort`, `map`, срезы.
"""

from __future__ import annotations

import json
import re
from typing import Any

from jinja2 import ChainableUndefined
from jinja2.sandbox import SandboxedEnvironment

# Неразрывный пробел между разрядами: в Discord строка не переносится по нему.
_THIN_SPACE = " "


def format_number(value: Any) -> str:
    """1050000.0 → «1 050 000», 12.345 → «12,35». Не число — как есть.

    Список превращается в перечисление через запятую: repr питоновского списка
    (`['А', 'Б']`) в карточке игрока выглядит как поломка, а не как данные.
    """
    if isinstance(value, (list, tuple)):
        return ", ".join(_item_text(item) for item in value)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return "" if value is None else str(value)
    if isinstance(value, float) and not value.is_integer():
        text = f"{round(value, 2):,.2f}".replace(",", _THIN_SPACE).replace(".", ",")
    else:
        text = f"{int(value):,}".replace(",", _THIN_SPACE)
    return text


def _item_text(value: Any) -> str:
    """Один элемент списка строкой: число — с разрядами, объект — JSON."""
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, ensure_ascii=False)
    return format_number(value)


def _finalize(value: Any) -> Any:
    """Что подставляется в `{{ … }}` перед выводом.

    Трогаем только списки. Undefined обязан пройти нетронутым, иначе
    отсутствующий атрибут перестанет рендериться пустой строкой; словари
    оставлены как есть — для них есть фильтр `поля`.
    """
    return format_number(value) if isinstance(value, (list, tuple)) else value


# SandboxedEnvironment — на случай недоверенного ввода; ChainableUndefined —
# отсутствующие ключи рендерятся пустой строкой, а не падают ошибкой.
_env = SandboxedEnvironment(
    undefined=ChainableUndefined,
    autoescape=False,
    trim_blocks=True,
    lstrip_blocks=True,
    finalize=_finalize,
)


def _as_items(value: Any) -> list[Any] | None:
    """Элементы списка (или значения словаря). Не коллекция — None."""
    if isinstance(value, (list, tuple)):
        return list(value)
    if isinstance(value, dict):
        return list(value.values())
    return None


def _dig(item: dict[str, Any], path: str) -> Any:
    """Поле элемента по dot-path — как везде в проекте."""
    node: Any = item
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def _filter_signed(value: Any) -> str:
    """Показать знак: прирост +12 400, убыль -80. Ноль остаётся без знака."""
    text = format_number(value)
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
        return f"+{text}"
    return text


def _filter_fields(value: Any, знак: bool = False) -> str:
    """Ветка формул (или обычный объект) списком «Подпись: значение».

    У ветки берутся подписи из вычисляемых полей и порядок их объявления;
    поле с ошибкой показывается прочерком, а не пропадает молча.
    `поля(знак=true)` — для веток вроде бюджета, где важен плюс перед приростом.
    """
    from app.computed import Branch

    if isinstance(value, Branch):
        pairs: list[tuple[str, Any]] = value.leaves
    elif isinstance(value, dict):
        pairs = list(value.items())
    else:
        return format_number(value)
    show = _filter_signed if знак else format_number
    lines = []
    for label, item in pairs:
        if isinstance(item, dict):
            continue  # вложенные ветки уже разложены в листья
        lines.append(f"{label}: {show(item) if item is not None else '—'}")
    return "\n".join(lines)


def _filter_bullets(value: Any, маркер: str = "•") -> str:
    """Список по строке на элемент: `{{ духи | список }}`."""
    items = _as_items(value)
    if items is None:
        return format_number(value)
    return "\n".join(f"{маркер} {_item_text(item)}".strip() for item in items)


def _filter_numbered(value: Any) -> str:
    """Нумерованный список: `{{ духи | нумерованный }}`."""
    items = _as_items(value)
    if items is None:
        return format_number(value)
    return "\n".join(f"{i}. {_item_text(item)}" for i, item in enumerate(items, 1))


def _filter_comma(value: Any, разделитель: str = ", ", пусто: str = "") -> str:
    """Список в строку. `пусто` — что показать вместо пустого перечисления."""
    items = _as_items(value)
    if items is None:
        return format_number(value)
    if not items:
        return пусто
    return разделитель.join(_item_text(item) for item in items)


def _filter_count(value: Any) -> int:
    """Сколько элементов: `{{ духи | сколько }}`."""
    items = _as_items(value)
    if items is not None:
        return len(items)
    return len(value) if isinstance(value, str) else 0


# `{имя}` в формате для фильтра «строки».
_FIELD_RE = re.compile(r"\{([^{}]+)\}")


def _filter_rows(value: Any, формат: str) -> str:
    """Список объектов по формату: `строки("{название} — {мощь}")`.

    Поля подставляются регуляркой, а не str.format: через формат-строку
    открывался бы доступ к атрибутам объектов, чего песочница не допускает.
    Элементы-не-словари пропускаются, отсутствующее поле даёт пустую строку.
    """
    items = _as_items(value)
    if items is None:
        return format_number(value)

    lines: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue

        def field(match: re.Match[str], source: dict[str, Any] = item) -> str:
            found = _dig(source, match.group(1).strip())
            return "" if found is None else _item_text(found)

        lines.append(_FIELD_RE.sub(field, формат))
    return "\n".join(lines)


_env.filters["число"] = format_number
_env.filters["со_знаком"] = _filter_signed
_env.filters["поля"] = _filter_fields
_env.filters["список"] = _filter_bullets
_env.filters["нумерованный"] = _filter_numbered
_env.filters["через_запятую"] = _filter_comma
_env.filters["сколько"] = _filter_count
_env.filters["строки"] = _filter_rows


def render_entity_template(
    template_str: str,
    attributes: dict[str, Any] | None,
    *,
    label: str = "",
    extra: dict[str, Any] | None = None,
) -> str:
    """Отрендерить шаблон типа с атрибутами сущности.

    В контекст кладутся сами ключи attributes (для `{{ ключ }}`), плюс
    `attrs`/`attributes` (dict-доступ) и `label`.
    """
    attributes = attributes or {}
    context: dict[str, Any] = {
        **attributes,
        "attrs": attributes,
        "attributes": attributes,
        "label": label,
    }
    if extra:
        context.update(extra)
    return _env.from_string(template_str or "").render(**context)


# Предел описания одного эмбеда. Discord режет на 4096, но мастерам показываем
# 2000: страница длиннее плохо читается в клиенте и почти всегда просится разбить.
PAGE_SOFT_LIMIT = 2000
PAGE_HARD_LIMIT = 4096


def as_pages(pages: Any, fallback: str = "") -> list[str]:
    """Список страниц описания из JSONB-поля.

    Пусто — берём fallback (старый одностраничный шаблон типа), чтобы записи,
    созданные до появления страниц, продолжали отображаться.
    """
    if isinstance(pages, list):
        cleaned = [str(p) for p in pages if str(p).strip()]
        if cleaned:
            return cleaned
    return [fallback] if fallback.strip() else []


def as_colors(colors: Any, count: int) -> list[str]:
    """Цвета страниц ровно по числу страниц.

    Список хранится отдельно от страниц и может отстать от них (страницу
    добавили в другой сессии) — недостающие добираются пустыми, лишние
    отбрасываются. Пустой цвет = цвет эмбеда по умолчанию.
    """
    values = [str(c or "").strip() for c in colors] if isinstance(colors, list) else []
    values = [c if _COLOR_RE.fullmatch(c) else "" for c in values]
    return (values + [""] * count)[:count]


# Только #rrggbb: этот формат понимают и Discord, и <input type="color">.
_COLOR_RE = re.compile(r"#[0-9a-fA-F]{6}")


def render_pages(
    pages: list[str],
    attributes: dict[str, Any] | None,
    *,
    label: str = "",
    extra: dict[str, Any] | None = None,
) -> list[str]:
    """Отрендерить страницы описания. В Discord они листаются кнопками.

    Ошибка рендера (например, арифметика по отсутствующему атрибуту) остаётся
    внутри своей страницы: карточка игрока не должна падать целиком из-за
    опечатки в одной строке шаблона.
    """
    rendered: list[str] = []
    for page in pages:
        try:
            text = render_entity_template(page, attributes, label=label, extra=extra)
        except Exception as exc:  # noqa: BLE001 — любая ошибка шаблона
            text = f"⚠ Ошибка в шаблоне: {exc}"
        rendered.append(text[:PAGE_HARD_LIMIT])
    return rendered


def validate_template(template_str: str) -> str | None:
    """Проверить синтаксис шаблона. Возвращает текст ошибки или None."""
    from jinja2 import TemplateSyntaxError

    try:
        _env.from_string(template_str or "")
        return None
    except TemplateSyntaxError as exc:
        return f"Строка {exc.lineno}: {exc.message}"
