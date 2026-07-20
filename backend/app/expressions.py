"""Безопасное вычисление арифметики над атрибутами сущности.

Мастер пишет в правке верда выражение вида:
    ВС.людские_ресурсы - 10
    политика.поддержка_партии_власти + 100
    экономика.ВВП * 1.05
    min(запасы.еда + 50, 1000)

Пути к атрибутам разыменовываются через точку. НЕ используется eval():
выражение разбирается в AST и обходится с белым списком узлов.
"""

from __future__ import annotations

import ast
import operator
from typing import Any

_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY_OPS = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_FUNCS = {
    "min": min,
    "max": max,
    "abs": abs,
    "round": round,
    "int": int,
    "float": float,
}
# Защита от выражений вида 9**9**9, вешающих процесс.
_MAX_POW = 1_000_000


class ExpressionError(Exception):
    pass


def _dotted_name(node: ast.AST) -> str | None:
    """Собрать 'политика.правительство.лидер' из AST-узла Attribute/Name."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _dotted_name(node.value)
        return f"{base}.{node.attr}" if base else None
    return None


def _lookup(path: str, attributes: dict[str, Any]) -> Any:
    node: Any = attributes
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            raise ExpressionError(f"Атрибут «{path}» не найден")
        node = node[part]
    return node


def _to_number(value: Any, path: str) -> float | int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ExpressionError(f"Атрибут «{path}» не число: {value!r}")
    return value


def _eval(node: ast.AST, attributes: dict[str, Any]) -> Any:
    if isinstance(node, ast.Expression):
        return _eval(node.body, attributes)

    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise ExpressionError(f"Недопустимая константа: {node.value!r}")
        return node.value

    if isinstance(node, (ast.Name, ast.Attribute)):
        path = _dotted_name(node)
        if path is None:
            raise ExpressionError("Не удалось разобрать путь к атрибуту")
        return _to_number(_lookup(path, attributes), path)

    if isinstance(node, ast.BinOp):
        op = _BIN_OPS.get(type(node.op))
        if op is None:
            raise ExpressionError("Недопустимая операция")
        left, right = _eval(node.left, attributes), _eval(node.right, attributes)
        if isinstance(node.op, ast.Pow) and abs(right) > 64:
            raise ExpressionError("Слишком большая степень")
        try:
            result = op(left, right)
        except ZeroDivisionError:
            raise ExpressionError("Деление на ноль")
        if isinstance(result, (int, float)) and abs(result) > 1e18:
            raise ExpressionError("Результат слишком велик")
        return result

    if isinstance(node, ast.UnaryOp):
        op = _UNARY_OPS.get(type(node.op))
        if op is None:
            raise ExpressionError("Недопустимая унарная операция")
        return op(_eval(node.operand, attributes))

    if isinstance(node, ast.Call):
        name = node.func.id if isinstance(node.func, ast.Name) else None
        func = _FUNCS.get(name or "")
        if func is None:
            raise ExpressionError(f"Функция «{name}» недоступна")
        if node.keywords:
            raise ExpressionError("Именованные аргументы не поддерживаются")
        return func(*[_eval(a, attributes) for a in node.args])

    raise ExpressionError("Недопустимое выражение")


def evaluate(expression: str, attributes: dict[str, Any]) -> float | int:
    """Вычислить выражение над атрибутами. Бросает ExpressionError при проблеме."""
    text = (expression or "").strip()
    if not text:
        raise ExpressionError("Пустое выражение")
    if len(text) > 500:
        raise ExpressionError("Выражение слишком длинное")
    try:
        tree = ast.parse(text, mode="eval")
    except SyntaxError as exc:
        raise ExpressionError(f"Синтаксическая ошибка: {exc.msg}")
    result = _eval(tree, attributes)
    if not isinstance(result, (int, float)) or isinstance(result, bool):
        raise ExpressionError("Результат не число")
    # 0.30000000000000004 → 0.3
    if isinstance(result, float):
        rounded = round(result, 10)
        return int(rounded) if rounded.is_integer() else rounded
    return result
