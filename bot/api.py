"""Асинхронный клиент к backend /internal/* ручкам."""

from typing import Any
from typing import Optional

import httpx

from config import config


class ApiClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=config.api_base,
            headers={"X-Internal-Key": config.internal_api_key},
            timeout=15.0,
        )

    async def close(self) -> None:
        await self._client.aclose()

    # ---------- верды ----------
    async def pending_posts(self) -> list[dict[str, Any]]:
        r = await self._client.get("/internal/pending-posts")
        r.raise_for_status()
        return r.json()

    async def fetch_attachment(self, url: str) -> bytes:
        """Скачать вложение с backend (url вида /uploads/1/abc_file.png)."""
        r = await self._client.get(url)
        r.raise_for_status()
        return r.content

    async def mark_delivered(self, post_id: int, message_id: int) -> None:
        r = await self._client.post(
            f"/internal/posts/{post_id}/delivered", json={"message_id": message_id}
        )
        r.raise_for_status()

    # ---------- вебхуки ----------
    async def get_webhook(self, channel_id: int) -> Optional[dict[str, Any]]:
        r = await self._client.get(f"/internal/webhooks/{channel_id}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    async def save_webhook(
        self, channel_id: int, webhook_id: int, token: str, url: str, project_id: Optional[int]
    ) -> None:
        r = await self._client.post(
            "/internal/webhooks",
            json={
                "discord_channel_id": channel_id,
                "webhook_id": webhook_id,
                "webhook_token": token,
                "webhook_url": url,
                "project_id": project_id,
            },
        )
        r.raise_for_status()

    # ---------- команды ----------
    async def me_info(
        self, guild_id: int, player_id: int, channel_id: Optional[int] = None
    ) -> Optional[dict[str, Any]]:
        params: dict[str, Any] = {"guild_id": guild_id, "player_id": player_id}
        if channel_id:
            params["channel_id"] = channel_id
        r = await self._client.get("/internal/me-info", params=params)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    async def ping(
        self, guild_id: int, player_id: int, channel_id: Optional[int], message: str
    ) -> None:
        r = await self._client.post(
            "/internal/ping",
            json={
                "guild_id": guild_id,
                "player_id": player_id,
                "discord_channel_id": channel_id,
                "message": message,
            },
        )
        r.raise_for_status()

    async def open_form(
        self, guild_id: int, channel_id: Optional[int] = None
    ) -> Optional[dict[str, Any]]:
        params: dict[str, Any] = {"guild_id": guild_id}
        if channel_id:
            params["channel_id"] = channel_id
        r = await self._client.get("/internal/forms/open", params=params)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    async def submit_registration(
        self, form_id: int, user_id: int, username: str, answers: dict[str, Any]
    ) -> None:
        r = await self._client.post(
            "/internal/registrations",
            json={
                "form_id": form_id,
                "discord_user_id": user_id,
                "discord_username": username,
                "answers": answers,
            },
        )
        r.raise_for_status()
