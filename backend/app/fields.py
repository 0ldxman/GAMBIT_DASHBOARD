"""Типы полей для схем.

Discord snowflake (19 цифр) превышает Number.MAX_SAFE_INTEGER в JavaScript
(9007199254740991, 16 цифр), поэтому в JSON такие ID отдаются/принимаются
СТРОКОЙ. В Python/БД они остаются int (BigInteger).
"""

from typing import Annotated
from typing import Any
from typing import Optional

from pydantic import BeforeValidator
from pydantic import PlainSerializer


def _parse_snowflake(value: Any) -> Any:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        return int(value)
    return value


DiscordId = Annotated[
    int,
    BeforeValidator(_parse_snowflake),
    PlainSerializer(lambda v: str(v), return_type=str, when_used="json"),
]

OptionalDiscordId = Optional[DiscordId]
