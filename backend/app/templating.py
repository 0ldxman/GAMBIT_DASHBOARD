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
"""

from __future__ import annotations

from typing import Any

from jinja2 import ChainableUndefined
from jinja2.sandbox import SandboxedEnvironment

# SandboxedEnvironment — на случай недоверенного ввода; ChainableUndefined —
# отсутствующие ключи рендерятся пустой строкой, а не падают ошибкой.
_env = SandboxedEnvironment(
    undefined=ChainableUndefined,
    autoescape=False,
    trim_blocks=True,
    lstrip_blocks=True,
)

# Неразрывный пробел между разрядами: в Discord строка не переносится по нему.
_THIN_SPACE = " "


def format_number(value: Any) -> str:
    """1050000.0 → «1 050 000», 12.345 → «12,35». Не число — как есть."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return "" if value is None else str(value)
    if isinstance(value, float) and not value.is_integer():
        text = f"{round(value, 2):,.2f}".replace(",", _THIN_SPACE).replace(".", ",")
    else:
        text = f"{int(value):,}".replace(",", _THIN_SPACE)
    return text


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


_env.filters["число"] = format_number
_env.filters["со_знаком"] = _filter_signed
_env.filters["поля"] = _filter_fields


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
