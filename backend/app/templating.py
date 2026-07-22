"""Рендер embed-шаблонов типов сущностей (Jinja2, с поддержкой кириллицы).

Шаблон пишется мастером в EntityType.attributes_template, значения берутся из
Entity.attributes. Пример шаблона:

    **{{ label }}**
    Столица: {{ столица }}
    Население: {{ население }}
    Армия: {{ attrs['военная сила'] }}

Кириллические имена-идентификаторы (`{{ столица }}`) работают напрямую.
Ключи с пробелами/спецсимволами — через `{{ attrs['...'] }}`.
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
    """Отрендерить страницы описания. Каждая уходит отдельным эмбедом."""
    return [
        render_entity_template(page, attributes, label=label, extra=extra)[:PAGE_HARD_LIMIT]
        for page in pages
    ]


def validate_template(template_str: str) -> str | None:
    """Проверить синтаксис шаблона. Возвращает текст ошибки или None."""
    from jinja2 import TemplateSyntaxError

    try:
        _env.from_string(template_str or "")
        return None
    except TemplateSyntaxError as exc:
        return f"Строка {exc.lineno}: {exc.message}"
