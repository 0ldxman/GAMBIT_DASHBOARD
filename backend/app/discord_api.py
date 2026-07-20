"""Тонкий клиент Discord REST API (для справочных данных в дашборде).

Использует токен бота. Нужен, чтобы мастер выбирал каналы из списка сервера
и видел имя/аватар закреплённого игрока, а не голый ID.
"""

from typing import Any
from typing import Optional

import httpx

from app.config import get_settings

API = "https://discord.com/api/v10"

# Типы каналов Discord, интересные мастеру.
CHANNEL_TYPE_NAMES = {
    0: "text",
    2: "voice",
    4: "category",
    5: "news",
    13: "stage",
    15: "forum",
}


class DiscordError(Exception):
    pass


def _headers() -> dict[str, str]:
    token = get_settings().discord_bot_token
    if not token:
        raise DiscordError("DISCORD_BOT_TOKEN не задан в настройках backend")
    return {"Authorization": f"Bot {token}"}


async def _get(path: str) -> Any:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{API}{path}", headers=_headers())
    if r.status_code == 401:
        raise DiscordError("Discord отклонил токен бота (401)")
    if r.status_code == 403:
        raise DiscordError("У бота нет доступа (403). Приглашён ли он на сервер?")
    if r.status_code == 404:
        raise DiscordError("Не найдено в Discord (404). Верный ли guild_id?")
    if r.status_code >= 400:
        raise DiscordError(f"Discord API вернул {r.status_code}: {r.text[:200]}")
    return r.json()


def avatar_url(user_id: int, avatar_hash: Optional[str], discriminator: str = "0") -> str:
    """Ссылка на аватар пользователя (или дефолтную заглушку Discord)."""
    if avatar_hash:
        ext = "gif" if avatar_hash.startswith("a_") else "png"
        return f"https://cdn.discordapp.com/avatars/{user_id}/{avatar_hash}.{ext}?size=128"
    index = (user_id >> 22) % 6 if discriminator in ("0", "") else int(discriminator) % 5
    return f"https://cdn.discordapp.com/embed/avatars/{index}.png"


async def list_guild_channels(guild_id: int) -> list[dict[str, Any]]:
    """Каналы сервера, отсортированные и с именем категории-родителя."""
    raw = await _get(f"/guilds/{guild_id}/channels")
    by_id = {int(c["id"]): c for c in raw}
    result: list[dict[str, Any]] = []
    for c in raw:
        parent_id = c.get("parent_id")
        parent = by_id.get(int(parent_id)) if parent_id else None
        result.append(
            {
                "channel_id": str(c["id"]),
                "name": c.get("name", ""),
                "type": CHANNEL_TYPE_NAMES.get(c.get("type"), str(c.get("type"))),
                "position": c.get("position", 0),
                "parent_name": parent.get("name") if parent else None,
            }
        )
    result.sort(key=lambda c: (c["parent_name"] or "", c["position"]))
    return result


async def get_guild_member(guild_id: int, user_id: int) -> dict[str, Any]:
    """Имя (ник на сервере, иначе username) и аватар участника."""
    data = await _get(f"/guilds/{guild_id}/members/{user_id}")
    user = data.get("user") or {}
    uid = int(user.get("id", user_id))
    # Приоритет: ник на сервере → global_name → username.
    name = data.get("nick") or user.get("global_name") or user.get("username") or str(uid)
    # Серверный аватар важнее глобального.
    if data.get("avatar"):
        ext = "gif" if data["avatar"].startswith("a_") else "png"
        url = (
            f"https://cdn.discordapp.com/guilds/{guild_id}/users/{uid}"
            f"/avatars/{data['avatar']}.{ext}?size=128"
        )
    else:
        url = avatar_url(uid, user.get("avatar"), str(user.get("discriminator", "0")))
    return {"player_id": str(uid), "name": name, "avatar_url": url}
