"""Работа с вложенными атрибутами сущностей.

Атрибуты — произвольный JSON, в шаблонах доступны через точку:
    {{ ВС.людские_ресурсы }}, {{ политика.правительство.лидер }}

Правки верда (entity_edits) поддерживают два вида ключей:
  1. Вложенный объект:  {"ВС": {"танки": 120}}      → сливается вглубь (deep merge)
  2. Dot-path строкой:   {"ВС.танки": 120}          → раскрывается в {"ВС": {"танки": 120}}
"""

from copy import deepcopy
from typing import Any


def expand_dot_paths(data: dict[str, Any]) -> dict[str, Any]:
    """Превратить ключи вида "a.b.c" во вложенные словари."""
    out: dict[str, Any] = {}
    for key, value in data.items():
        if "." not in key:
            # Значение-словарь тоже может содержать dot-path внутри.
            out[key] = expand_dot_paths(value) if isinstance(value, dict) else value
            continue
        parts = key.split(".")
        node = out
        for part in parts[:-1]:
            nxt = node.get(part)
            if not isinstance(nxt, dict):
                nxt = {}
                node[part] = nxt
            node = nxt
        node[parts[-1]] = expand_dot_paths(value) if isinstance(value, dict) else value
    return out


def deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Слить patch в base вглубь: перезаписываются только указанные листья.

    Словари сливаются рекурсивно; любые другие значения (в т.ч. списки) заменяются.
    Значение None удаляет ключ — так мастер может убрать атрибут вердом.
    """
    result = deepcopy(base) if base else {}
    for key, value in patch.items():
        if value is None:
            result.pop(key, None)
        elif isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def apply_attribute_patch(
    current: dict[str, Any] | None, patch: dict[str, Any] | None
) -> dict[str, Any]:
    """Применить правку атрибутов: dot-path → вложенность → deep merge."""
    return deep_merge(current or {}, expand_dot_paths(patch or {}))
