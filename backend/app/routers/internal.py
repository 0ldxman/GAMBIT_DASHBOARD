"""Ручки для Discord-бота. Защита — общий секрет X-Internal-Key (не мастерский токен)."""

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import ChannelWebhook
from app.models import Entity
from app.models import EntityType
from app.models import Notification
from app.models import NotificationType
from app.models import Post
from app.models import PostStatus
from app.models import Project
from app.models import EntityMember
from app.models import Registration
from app.models import RegistrationForm
from app.resolve import project_for_channel
from app.schemas import DeliveredIn
from app.schemas import MeInfoOut
from app.schemas import PendingPostOut
from app.schemas import PingIn
from app.schemas import RegistrationCreate
from app.schemas import RegistrationFormOut
from app.schemas import WebhookIn
from app.schemas import WebhookOut
from app.security import require_internal
from app.templating import render_entity_template

router = APIRouter(prefix="/internal", tags=["internal"], dependencies=[Depends(require_internal)])


async def _resolve_project(
    guild_id: int, channel_id: int | None, db: AsyncSession
) -> Project:
    """Проект для команды бота (см. app/resolve.py) или понятная 404."""
    project = await project_for_channel(guild_id, channel_id or 0, db)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "Не удалось определить проект. Выполните команду в канале проекта "
                "или зарегистрируйте категорию проекта в дашборде."
            ),
        )
    return project


# ---------- доставка вердов ----------
@router.get("/pending-posts", response_model=list[PendingPostOut])
async def pending_posts(db: AsyncSession = Depends(get_db)) -> list[Post]:
    """Опубликованные верды, ещё не отправленные ботом (нужен target_channel_id)."""
    result = await db.execute(
        select(Post).where(
            Post.status == PostStatus.published,
            Post.published_message_id.is_(None),
            Post.target_channel_id.is_not(None),
        )
    )
    return list(result.scalars().all())


@router.post("/posts/{post_id}/delivered")
async def mark_delivered(
    post_id: int, body: DeliveredIn, db: AsyncSession = Depends(get_db)
) -> dict[str, str]:
    post = await db.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Верд не найден")
    post.published_message_id = body.message_id
    await db.commit()
    return {"status": "ok"}


# ---------- кэш вебхуков ----------
@router.get("/webhooks/{discord_channel_id}", response_model=WebhookOut)
async def get_webhook(discord_channel_id: int, db: AsyncSession = Depends(get_db)) -> ChannelWebhook:
    result = await db.execute(
        select(ChannelWebhook).where(ChannelWebhook.discord_channel_id == discord_channel_id)
    )
    wh = result.scalar_one_or_none()
    if wh is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Вебхук не закэширован")
    return wh


@router.post("/webhooks", response_model=WebhookOut)
async def save_webhook(body: WebhookIn, db: AsyncSession = Depends(get_db)) -> ChannelWebhook:
    """Upsert по discord_channel_id (бот создал вебхук — кэшируем)."""
    stmt = (
        pg_insert(ChannelWebhook)
        .values(**body.model_dump())
        .on_conflict_do_update(
            index_elements=[ChannelWebhook.discord_channel_id],
            set_={
                "webhook_id": body.webhook_id,
                "webhook_token": body.webhook_token,
                "webhook_url": body.webhook_url,
                "project_id": body.project_id,
            },
        )
        .returning(ChannelWebhook)
    )
    result = await db.execute(stmt)
    await db.commit()
    return result.scalar_one()


# ---------- команды ----------
@router.get("/me-info", response_model=MeInfoOut)
async def me_info(
    guild_id: int,
    player_id: int,
    channel_id: int | None = None,
    db: AsyncSession = Depends(get_db),
) -> MeInfoOut:
    """Рендер embed сущности игрока (команда /me-info). Проект — по каналу."""
    project = await _resolve_project(guild_id, channel_id, db)
    result = await db.execute(
        select(Entity)
        .join(EntityMember, EntityMember.entity_id == Entity.id)
        .where(Entity.project_id == project.id, EntityMember.player_id == player_id)
        # Основная сущность игрока — первой.
        .order_by(EntityMember.is_primary.desc())
    )
    entity = result.scalars().first()
    if entity is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="За вами не закреплена сущность")
    template = ""
    if entity.type_id is not None:
        et = await db.get(EntityType, entity.type_id)
        if et is not None:
            template = et.attributes_template
    rendered = render_entity_template(template, entity.attributes, label=entity.label)
    return MeInfoOut(entity_id=entity.id, label=entity.label, rendered=rendered)


@router.post("/ping")
async def ping_master(body: PingIn, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    """Игрок пингует мастера → уведомление во фронтенд."""
    project = await _resolve_project(body.guild_id, body.discord_channel_id, db)
    # Если игрок состоит в сущности — приложим её к уведомлению.
    result = await db.execute(
        select(EntityMember)
        .join(Entity, Entity.id == EntityMember.entity_id)
        .where(Entity.project_id == project.id, EntityMember.player_id == body.player_id)
        .order_by(EntityMember.is_primary.desc())
    )
    membership = result.scalars().first()
    note = Notification(
        project_id=project.id,
        type=NotificationType.ping,
        message=body.message or "Игрок ожидает ответа мастера",
        entity_id=membership.entity_id if membership else None,
        player_id=body.player_id,
        discord_channel_id=body.discord_channel_id,
    )
    db.add(note)
    await db.commit()
    return {"status": "ok"}


# ---------- регистрация ----------
@router.get("/forms/open", response_model=RegistrationFormOut)
async def open_form(
    guild_id: int, channel_id: int | None = None, db: AsyncSession = Depends(get_db)
) -> RegistrationForm:
    """Открытая форма регистрации проекта (для команды /register)."""
    project = await _project_for(guild_id, channel_id, db)
    result = await db.execute(
        select(RegistrationForm)
        .where(RegistrationForm.project_id == project.id, RegistrationForm.is_open.is_(True))
        .order_by(RegistrationForm.created_at.desc())
    )
    form = result.scalars().first()
    if form is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Открытых форм нет")
    return form


@router.post("/registrations")
async def submit_registration(
    body: RegistrationCreate, db: AsyncSession = Depends(get_db)
) -> dict[str, str]:
    form = await db.get(RegistrationForm, body.form_id)
    if form is None or not form.is_open:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Форма недоступна")
    reg = Registration(
        form_id=form.id,
        project_id=form.project_id,
        discord_user_id=body.discord_user_id,
        discord_username=body.discord_username,
        answers=body.answers,
    )
    db.add(reg)
    db.add(
        Notification(
            project_id=form.project_id,
            type=NotificationType.registration,
            message=f"Новая заявка: {body.discord_username or body.discord_user_id}",
            player_id=body.discord_user_id,
        )
    )
    await db.commit()
    return {"status": "ok"}
