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

from app.attributes import apply_attribute_patch
from app.computed import compute
from app.computed import template_extra
from app.database import get_db
from app.expressions import ExpressionError
from app.expressions import evaluate
from app.models import Entity
from app.models import EntityType
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
    """Применить правки сущностей.

    Поддерживаются два формата:
      * ops — список операций set/expr/delete над dot-path (выражения считаются
        по АКТУАЛЬНЫМ атрибутам, последовательно, поэтому операции видят
        результат предыдущих);
      * attributes — прежний формат-патч (deep merge).
    """
    for edit in edits or []:
        if not isinstance(edit, dict):
            continue
        entity_id = edit.get("entity_id")
        if entity_id is None:
            continue
        ops = edit.get("ops") or []
        attrs = edit.get("attributes") or {}
        if not ops and not attrs:
            continue

        entity = await db.get(Entity, entity_id)
        if entity is None or entity.project_id != project_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Сущность {entity_id} не принадлежит проекту",
            )

        entity_type = (
            await db.get(EntityType, entity.type_id) if entity.type_id is not None else None
        )
        current = dict(entity.attributes or {})
        for op in ops:
            if not isinstance(op, dict):
                continue
            path = (op.get("path") or "").strip()
            if not path:
                continue
            mode = op.get("mode") or "set"
            if mode == "delete":
                current = apply_attribute_patch(current, {path: None})
            elif mode == "expr":
                # Формулы типа доступны как «выч.бюджет.итого». Пересчитываем на
                # каждой операции: предыдущие уже поменяли атрибуты.
                tree, _ = compute(entity_type.computed if entity_type else [], current)
                context = {**current, **template_extra(tree, current)}
                try:
                    value = evaluate(str(op.get("value") or ""), context)
                except ExpressionError as exc:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"«{entity.label}» → {path}: {exc}",
                    )
                current = apply_attribute_patch(current, {path: value})
            else:
                current = apply_attribute_patch(current, {path: op.get("value")})

        if attrs:
            current = apply_attribute_patch(current, attrs)
        entity.attributes = current


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
