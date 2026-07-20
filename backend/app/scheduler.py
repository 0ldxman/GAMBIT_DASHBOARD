"""Фоновый шедулер отложенной публикации вердов.

Раз в POLL_SECONDS поднимает верды со статусом scheduled, у которых наступил
scheduled_at, применяет их правки сущностей и переводит в published.
Отправку в Discord делает бот (см. posts.publish_post).
"""

import asyncio
import logging
from datetime import datetime
from datetime import timezone

from sqlalchemy import select

from app.database import SessionLocal
from app.models import PostStatus
from app.models import Post
from app.routers.posts import apply_entity_edits

logger = logging.getLogger("scheduler")
POLL_SECONDS = 30


async def _publish_due_posts() -> None:
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        result = await db.execute(
            select(Post).where(
                Post.status == PostStatus.scheduled,
                Post.scheduled_at.is_not(None),
                Post.scheduled_at <= now,
                Post.target_channel_id.is_not(None),
            )
        )
        due = list(result.scalars().all())
        published = 0
        for post in due:
            # Отдельная транзакция на верд: ошибка одного не должна откатывать
            # уже применённые правки других вердов из этого же батча.
            try:
                async with db.begin_nested():
                    await apply_entity_edits(post.project_id, post.entity_edits, db)
                    post.status = PostStatus.published
                    post.published_at = now
                await db.commit()
                published += 1
            except Exception:  # noqa: BLE001 — один плохой верд не должен ронять цикл
                logger.exception("Не удалось опубликовать верд %s", post.id)
        if published:
            logger.info("Опубликовано по расписанию: %d верд(ов)", published)


async def run_scheduler() -> None:
    while True:
        try:
            await _publish_due_posts()
        except Exception:  # noqa: BLE001
            logger.exception("Ошибка цикла шедулера")
        await asyncio.sleep(POLL_SECONDS)
