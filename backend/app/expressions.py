"""Безопасное вычисление арифметики над атрибутами сущности.

Мастер пишет в правке верда или в вычисляемом поле типа выражение вида:
    ВС.людские_ресурсы - 10
    политика.поддержка_партии_власти + 100
    экономика.ВВП * 1.05
    min(запасы.еда + 50, 1000)
    длина(духи)                     — сколько элементов в списке
    сумма(гигаструктуры, "мощь")    — сумма поля по списку объектов

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
# Функции над списками. Их аргументы НЕ приводятся к числу: на вход идёт сам
# список (и, возможно, имя поля строкой).
_LIST_FUNCS = ("длина", "сумма")
# Защита от выражений вида 9**9**9, вешающих процесс.
_MAX_POW = 1_000_000


class ExpressionError(Exception):
    pass


def _bad_func(name: str | None) -> ExpressionError:
    if name is None:
        # Например `модуль.функция(...)` — точечный вызов не разбирается вовсе.
        return ExpressionError("Так вызывать функции нельзя")
    return ExpressionError(f"Функция «{name}» недоступна")


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


def _raw(node: ast.AST, attributes: dict[str, Any]) -> Any:
    """Значение аргумента списочной функции как есть: список, строка, число."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, (ast.Name, ast.Attribute)):
        path = _dotted_name(node)
        if path is None:
            raise ExpressionError("Не удалось разобрать путь к атрибуту")
        return _lookup(path, attributes)
    return _eval(node, attributes)


def _as_list(value: Any, func: str) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return list(value.values())
    raise ExpressionError(f"«{func}» ожидает список, получено: {value!r}")


def _call_list_func(name: str, args: list[Any]) -> float | int:
    if name == "длина":
        if len(args) != 1:
            raise ExpressionError("«длина» принимает один аргумент")
        value = args[0]
        if isinstance(value, (list, dict, str)):
            return len(value)
        raise ExpressionError(f"«длина» ожидает список или строку, получено: {value!r}")

    # сумма(список) либо сумма(список_объектов, "поле")
    if not 1 <= len(args) <= 2:
        raise ExpressionError("«сумма» принимает список и, необязательно, имя поля")
    items = _as_list(args[0], "сумма")
    field = args[1] if len(args) == 2 else None
    if field is not None and not isinstance(field, str):
        raise ExpressionError("Имя поля для «сумма» задаётся строкой в кавычках")

    total: float | int = 0
    for item in items:
        if field is not None:
            if not isinstance(item, dict) or field not in item:
                raise ExpressionError(f"В элементе списка нет поля «{field}»: {item!r}")
            item = item[field]
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise ExpressionError(f"Не число в списке: {item!r}")
        total += item
    return total


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
        if node.keywords:
            raise ExpressionError("Именованные аргументы не поддерживаются")
        if name in _LIST_FUNCS:
            return _call_list_func(name, [_raw(a, attributes) for a in node.args])
        func = _FUNCS.get(name or "")
        if func is None:
            raise _bad_func(name)
        return func(*[_eval(a, attributes) for a in node.args])

    raise ExpressionError("Недопустимое выражение")


def _check_node(node: ast.AST) -> None:
    """Обойти дерево тем же белым списком, что и _eval, но без значений."""
    if isinstance(node, ast.Constant):
        # Строка допустима как имя поля: сумма(гигаструктуры, "мощь").
        if isinstance(node.value, str):
            return
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise ExpressionError(f"Недопустимая константа: {node.value!r}")
        return

    if isinstance(node, (ast.Name, ast.Attribute)):
        if _dotted_name(node) is None:
            raise ExpressionError("Не удалось разобрать путь к атрибуту")
        return

    if isinstance(node, ast.BinOp):
        if type(node.op) not in _BIN_OPS:
            raise ExpressionError("Недопустимая операция")
        _check_node(node.left)
        _check_node(node.right)
        return

    if isinstance(node, ast.UnaryOp):
        if type(node.op) not in _UNARY_OPS:
            raise ExpressionError("Недопустимая унарная операция")
        _check_node(node.operand)
        return

    if isinstance(node, ast.Call):
        name = node.func.id if isinstance(node.func, ast.Name) else None
        if node.keywords:
            raise ExpressionError("Именованные аргументы не поддерживаются")
        if name not in _FUNCS and name not in _LIST_FUNCS:
            raise _bad_func(name)
        for arg in node.args:
            _check_node(arg)
        return

    raise ExpressionError("Недопустимое выражение")


def check(expression: str) -> str | None:
    """Проверить выражение, не зная значений атрибутов.

    Нужно при сохранении формул: считать их там не на чем, но синтаксис и
    белый список узлов проверить обязаны. Возвращает текст ошибки или None.
    """
    text = (expression or "").strip()
    if not text:
        return "Пустое выражение"
    if len(text) > 500:
        return "Выражение слишком длинное"
    try:
        tree = ast.parse(text, mode="eval")
    except SyntaxError as exc:
        return f"Синтаксическая ошибка: {exc.msg}"
    try:
        _check_node(tree.body)
    except ExpressionError as exc:
        return str(exc)
    return None


def dependencies(expression: str) -> list[str]:
    """Пути к атрибутам, которые упоминает выражение.

    Нужно вычисляемым полям: по этому списку строится порядок вычисления и
    ловятся циклы. Имена функций сюда не попадают.
    """
    try:
        tree = ast.parse((expression or "").strip() or "0", mode="eval")
    except SyntaxError:
        return []

    found: list[str] = []

    def walk(node: ast.AST) -> None:
        if isinstance(node, (ast.Name, ast.Attribute)):
            path = _dotted_name(node)
            if path and path not in found:
                found.append(path)
            return
        for child in ast.iter_child_nodes(node):
            # Имя функции — не путь к атрибуту: min(...) это не атрибут «min».
            if isinstance(node, ast.Call) and child is node.func:
                continue
            walk(child)

    walk(tree)
    return found


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
