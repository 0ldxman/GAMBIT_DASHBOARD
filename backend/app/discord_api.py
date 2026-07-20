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
    raw = get_settings().discord_bot_token
    token = (raw or "").strip()
    if not token:
        raise DiscordError(
            "DISCORD_BOT_TOKEN пуст в окружении backend-контейнера. "
            "Переменная должна быть объявлена в блоке environment сервиса backend "
            "(не только в переменных стека). Проверьте: GET /health/config"
        )
    # Токен часто вставляют с кавычками или префиксом — Discord вернёт 401.
    if token.startswith(("Bot ", "Bearer ")):
        token = token.split(" ", 1)[1]
    token = token.strip("\"'")
    return {"Authorization": f"Bot {token}"}


async def _request(method: str, path: str, json: Any = None) -> Any:
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.request(method, f"{API}{path}", headers=_headers(), json=json)
    if r.status_code == 401:
        raise DiscordError("Discord отклонил токен бота (401)")
    if r.status_code == 403:
        raise DiscordError(
            "У бота нет прав (403). Нужны Manage Channels и Manage Roles на сервере."
        )
    if r.status_code == 404:
        raise DiscordError("Не найдено в Discord (404)")
    if r.status_code == 429:
        raise DiscordError("Discord ограничил частоту запросов (429), попробуйте позже")
    if r.status_code >= 400:
        raise DiscordError(f"Discord API вернул {r.status_code}: {r.text[:200]}")
    return r.json() if r.content else None


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


def guild_icon_url(guild_id: int, icon_hash: Optional[str]) -> Optional[str]:
    if not icon_hash:
        return None
    ext = "gif" if icon_hash.startswith("a_") else "png"
    return f"https://cdn.discordapp.com/icons/{guild_id}/{icon_hash}.{ext}?size=128"


async def list_bot_guilds() -> list[dict[str, Any]]:
    """Серверы, на которых стоит бот. Мастер выбирает сервер, а не вводит guild_id."""
    raw = await _get("/users/@me/guilds")
    guilds = [
        {
            "guild_id": str(g["id"]),
            "name": g.get("name", ""),
            "icon_url": guild_icon_url(int(g["id"]), g.get("icon")),
        }
        for g in raw
    ]
    guilds.sort(key=lambda g: g["name"].lower())
    return guilds


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
                "parent_id": str(parent_id) if parent_id else None,
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


# ---------- роли ----------
async def list_guild_roles(guild_id: int) -> list[dict[str, Any]]:
    """Роли сервера (для выбора роли мастеров и роли игроков в настройках проекта)."""
    raw = await _get(f"/guilds/{guild_id}/roles")
    roles = [
        {"role_id": str(r["id"]), "name": r.get("name", ""), "position": r.get("position", 0)}
        for r in raw
        # @everyone имеет id == guild_id и как роль доступа бесполезна.
        if int(r["id"]) != guild_id and not r.get("managed")
    ]
    roles.sort(key=lambda r: -r["position"])
    return roles


# ---------- каналы ----------
# Биты прав Discord.
VIEW_CHANNEL = 1 << 10
SEND_MESSAGES = 1 << 11
_MEMBER_ALLOW = VIEW_CHANNEL | SEND_MESSAGES

CHANNEL_TYPE_IDS = {"text": 0, "voice": 2, "category": 4, "news": 5, "forum": 15}


async def create_channel(
    guild_id: int,
    name: str,
    channel_type: str = "text",
    parent_id: Optional[int] = None,
    private: bool = False,
    allow_role_ids: Optional[list[int]] = None,
    allow_user_ids: Optional[list[int]] = None,
) -> dict[str, Any]:
    """Создать канал. Для приватного закрывает @everyone и открывает указанным."""
    payload: dict[str, Any] = {
        "name": name,
        "type": CHANNEL_TYPE_IDS.get(channel_type, 0),
    }
    if parent_id:
        payload["parent_id"] = str(parent_id)

    if private:
        # type: 0 — роль, 1 — пользователь.
        overwrites: list[dict[str, Any]] = [
            {"id": str(guild_id), "type": 0, "deny": str(VIEW_CHANNEL)}  # @everyone
        ]
        for role_id in allow_role_ids or []:
            overwrites.append({"id": str(role_id), "type": 0, "allow": str(_MEMBER_ALLOW)})
        for user_id in allow_user_ids or []:
            overwrites.append({"id": str(user_id), "type": 1, "allow": str(_MEMBER_ALLOW)})
        payload["permission_overwrites"] = overwrites

    data = await _request("POST", f"/guilds/{guild_id}/channels", json=payload)
    return {
        "channel_id": str(data["id"]),
        "name": data.get("name", name),
        "type": CHANNEL_TYPE_NAMES.get(data.get("type"), channel_type),
        "parent_id": str(data["parent_id"]) if data.get("parent_id") else None,
    }


async def get_channel(channel_id: int) -> dict[str, Any]:
    data = await _get(f"/channels/{channel_id}")
    return {
        "channel_id": str(data["id"]),
        "name": data.get("name", ""),
        "type": CHANNEL_TYPE_NAMES.get(data.get("type"), str(data.get("type"))),
        "parent_id": str(data["parent_id"]) if data.get("parent_id") else None,
        "guild_id": str(data["guild_id"]) if data.get("guild_id") else None,
    }


async def delete_channel(channel_id: int) -> None:
    """Удалить канал в Discord. Необратимо — вызывать только по явному подтверждению."""
    await _request("DELETE", f"/channels/{channel_id}")


async def list_channel_overwrites(channel_id: int) -> list[dict[str, Any]]:
    data = await _get(f"/channels/{channel_id}")
    return data.get("permission_overwrites") or []


async def allow_user_in_channel(channel_id: int, user_id: int) -> None:
    await _request(
        "PUT",
        f"/channels/{channel_id}/permissions/{user_id}",
        json={"type": 1, "allow": str(_MEMBER_ALLOW), "deny": "0"},
    )


async def allow_role_in_channel(channel_id: int, role_id: int) -> None:
    await _request(
        "PUT",
        f"/channels/{channel_id}/permissions/{role_id}",
        json={"type": 0, "allow": str(_MEMBER_ALLOW), "deny": "0"},
    )


async def remove_overwrite(channel_id: int, target_id: int) -> None:
    await _request("DELETE", f"/channels/{channel_id}/permissions/{target_id}")
