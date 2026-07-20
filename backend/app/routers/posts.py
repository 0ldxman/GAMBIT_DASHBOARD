from datetime import datetime
from datetime import timezone
from typing import Optional

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Entity
from app.models import PostStatus
from app.models import Post
from app.routers.projects import get_project_or_404
from app.schemas import PostCreate
from app.schemas import PostOut
from app.schemas import PostUpdate
from app.security import require_master

router = APIRouter(
    prefix="/projects/{project_id}/posts",
    tags=["posts"],
    dependencies=[Depends(require_master)],
)


async def get_post_or_404(project_id: int, post_id: int, db: AsyncSession) -> Post:
    post = await db.get(Post, post_id)
    if post is None or post.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Верд не найден")
    return post


async def apply_entity_edits(project_id: int, edits: list, db: AsyncSession) -> None:
    """Применить правки сущностей: простое обновление (перезапись ключей attributes)."""
    for edit in edits or []:
        entity_id = edit.get("entity_id") if isinstance(edit, dict) else None
        attrs = edit.get("attributes") if isinstance(edit, dict) else None
        if entity_id is None or not attrs:
            continue
        entity = await db.get(Entity, entity_id)
        if entity is None or entity.project_id != project_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Сущность {entity_id} не принадлежит проекту",
            )
        # merge: перезаписываем указанные ключи, остальные сохраняем.
        entity.attributes = {**(entity.attributes or {}), **attrs}


@router.get("", response_model=list[PostOut])
async def list_posts(
    project_id: int,
    status_filter: Optional[PostStatus] = Query(default=None, alias="status"),
    db: AsyncSession = Depends(get_db),
) -> list[Post]:
    await get_project_or_404(project_id, db)
    query = select(Post).where(Post.project_id == project_id)
    if status_filter is not None:
        query = query.where(Post.status == status_filter)
    query = query.order_by(Post.created_at.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


@router.post("", response_model=PostOut, status_code=status.HTTP_201_CREATED)
async def create_post(
    project_id: int, body: PostCreate, db: AsyncSession = Depends(get_db)
) -> Post:
    await get_project_or_404(project_id, db)
    data = body.model_dump()
    data["entity_edits"] = [e.model_dump() for e in body.entity_edits]
    post = Post(project_id=project_id, status=PostStatus.draft, **data)
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return post


@router.get("/{post_id}", response_model=PostOut)
async def get_post(
    project_id: int, post_id: int, db: AsyncSession = Depends(get_db)
) -> Post:
    return await get_post_or_404(project_id, post_id, db)


@router.patch("/{post_id}", response_model=PostOut)
async def update_post(
    project_id: int, post_id: int, body: PostUpdate, db: AsyncSession = Depends(get_db)
) -> Post:
    post = await get_post_or_404(project_id, post_id, db)
    if post.status == PostStatus.published:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Опубликованный верд нельзя менять"
        )
    data = body.model_dump(exclude_unset=True)
    if "entity_edits" in data and data["entity_edits"] is not None:
        data["entity_edits"] = [e.model_dump() if hasattr(e, "model_dump") else e for e in data["entity_edits"]]
    for field, value in data.items():
        setattr(post, field, value)
    await db.commit()
    await db.refresh(post)
    return post


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(
    project_id: int, post_id: int, db: AsyncSession = Depends(get_db)
) -> None:
    post = await get_post_or_404(project_id, post_id, db)
    await db.delete(post)
    await db.commit()


@router.post("/{post_id}/publish", response_model=PostOut)
async def publish_post(
    project_id: int, post_id: int, db: AsyncSession = Depends(get_db)
) -> Post:
    """Опубликовать верд немедленно: применить правки сущностей и пометить published.

    Фактическую отправку в Discord выполняет бот (забирает published верды без
    published_message_id и проставляет id после отправки).
    """
    post = await get_post_or_404(project_id, post_id, db)
    if post.status == PostStatus.published:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Верд уже опубликован")
    if post.target_channel_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Не указан канал публикации (target_channel_id)",
        )
    await apply_entity_edits(project_id, post.entity_edits, db)
    post.status = PostStatus.published
    post.published_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(post)
    return post


@router.post("/{post_id}/schedule", response_model=PostOut)
async def schedule_post(
    project_id: int,
    post_id: int,
    scheduled_at: datetime = Query(..., description="Момент публикации (ISO 8601, UTC)"),
    db: AsyncSession = Depends(get_db),
) -> Post:
    """Запланировать отложенную публикацию верда."""
    post = await get_post_or_404(project_id, post_id, db)
    if post.status == PostStatus.published:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Верд уже опубликован")
    post.scheduled_at = scheduled_at
    post.status = PostStatus.scheduled
    await db.commit()
    await db.refresh(post)
    return post
