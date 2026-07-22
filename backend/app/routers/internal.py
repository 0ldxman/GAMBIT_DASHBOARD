"""Ручки для Discord-бота. Защита — общий секрет X-Internal-Key (не мастерский токен)."""

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.descriptions import render_entity_card
from app.models import ChannelSetting
from app.models import ChannelWebhook
from app.models import Entity
from app.models import EntityChannel
from app.models import Notification
from app.models import NotificationType
from app.models import Post
from app.models import PostStatus
from app.models import Project
from app.models import EntityMember
from app.models import ProxyChoice
from app.models import Registration
from app.models import RegistrationForm
from app.resolve import project_for_channel
from app.schemas import AboutProjectOut
from app.schemas import DeliveredIn
from app.schemas import MeInfoOut
from app.schemas import PendingPostOut
from app.schemas import PingIn
from app.schemas import ProjectBriefOut
from app.schemas import ProxyChoiceIn
from app.schemas import ProxyContextOut
from app.schemas import ProxyEntityOut
from app.schemas import RegistrationCreate
from app.schemas import RegistrationFormOut
from app.schemas import WebhookIn
from app.schemas import WebhookOut
from app.security import require_internal

router = APIRouter(prefix="/internal", tags=["internal"], dependencies=[Depends(require_internal)])


def public_url(path: str) -> str:
    """Абсолютный URL картинки для Discord.

    Аватарку вебхука Discord скачивает сам, поэтому внутренний путь /uploads/...
    ему бесполезен. Без PUBLIC_BASE_URL возвращаем пусто — лучше аватарка
    по умолчанию, чем битая ссылка.
    """
    if not path:
        return ""
    if path.startswith(("http://", "https://")):
        return path
    base = get_settings().public_base_url.rstrip("/")
    return f"{base}{path}" if base else ""


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
    """Карточка сущности игрока (команда /me-info). Проект — по каналу."""
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
    pages, colors = await render_entity_card(entity, db)
    return MeInfoOut(
        entity_id=entity.id,
        label=entity.label,
        rendered=pages[0] if pages else "",
        pages=pages,
        colors=colors,
        picture_url=public_url(entity.picture),
    )


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


# ---------- речь от лица сущности ----------
def _proxy_entity(entity: Entity) -> ProxyEntityOut:
    return ProxyEntityOut(
        entity_id=entity.id, label=entity.label, picture_url=public_url(entity.picture)
    )


@router.get("/proxy-channels", response_model=list[str])
async def proxy_channels(db: AsyncSession = Depends(get_db)) -> list[str]:
    """Каналы с авто-подменой. Бот держит их списком, чтобы не дёргать API
    на каждое сообщение сервера."""
    result = await db.execute(
        select(ChannelSetting.discord_channel_id).where(ChannelSetting.auto_proxy.is_(True))
    )
    return [str(row[0]) for row in result.all()]


@router.get("/proxy", response_model=ProxyContextOut)
async def proxy_context(
    guild_id: int,
    channel_id: int,
    player_id: int,
    db: AsyncSession = Depends(get_db),
) -> ProxyContextOut:
    """От лица какой сущности игрок говорит в этом канале.

    Кандидаты — его сущности, привязанные к каналу (те, что дают ему доступ).
    Если канал общий и привязок нет, берём все сущности игрока в проекте.
    """
    project = await _resolve_project(guild_id, channel_id, db)

    result = await db.execute(
        select(ChannelSetting.auto_proxy).where(
            ChannelSetting.discord_channel_id == channel_id,
            ChannelSetting.project_id == project.id,
        )
    )
    row = result.first()
    auto_proxy = bool(row[0]) if row else False

    mine = (
        select(Entity, EntityMember.is_primary)
        .join(EntityMember, EntityMember.entity_id == Entity.id)
        .where(Entity.project_id == project.id, EntityMember.player_id == player_id)
    )
    linked = await db.execute(
        mine.join(EntityChannel, EntityChannel.entity_id == Entity.id).where(
            EntityChannel.discord_channel_id == channel_id
        )
    )
    rows = list(linked.all())
    if not rows:
        rows = list((await db.execute(mine)).all())

    candidates = {entity.id: (entity, is_primary) for entity, is_primary in rows}
    if not candidates:
        return ProxyContextOut(project_id=project.id, auto_proxy=auto_proxy)

    chosen: Entity | None = None
    if len(candidates) == 1:
        chosen = next(iter(candidates.values()))[0]
    else:
        # Явный выбор игрока (команда /say-as) — главнее любых догадок.
        result = await db.execute(
            select(ProxyChoice).where(
                ProxyChoice.player_id == player_id,
                ProxyChoice.discord_channel_id == channel_id,
            )
        )
        choice = result.scalar_one_or_none()
        if choice is not None and choice.entity_id in candidates:
            chosen = candidates[choice.entity_id][0]
        else:
            # Единственная сущность, где игрок основной — считаем её его лицом.
            leading = [e for e, is_primary in candidates.values() if is_primary]
            if len(leading) == 1:
                chosen = leading[0]

    return ProxyContextOut(
        project_id=project.id,
        auto_proxy=auto_proxy,
        entity=_proxy_entity(chosen) if chosen else None,
        candidates=[_proxy_entity(e) for e, _ in candidates.values()],
        ambiguous=chosen is None,
    )


@router.post("/proxy/choice", response_model=ProxyContextOut)
async def set_proxy_choice(
    body: ProxyChoiceIn, db: AsyncSession = Depends(get_db)
) -> ProxyContextOut:
    """Запомнить, от лица какой сущности игрок говорит в канале."""
    project = await _resolve_project(body.guild_id, body.discord_channel_id, db)
    entity = await db.get(Entity, body.entity_id)
    if entity is None or entity.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сущность не найдена")
    result = await db.execute(
        select(EntityMember).where(
            EntityMember.entity_id == entity.id, EntityMember.player_id == body.player_id
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Вы не игрок этой сущности"
        )

    stmt = (
        pg_insert(ProxyChoice)
        .values(
            player_id=body.player_id,
            discord_channel_id=body.discord_channel_id,
            entity_id=entity.id,
        )
        .on_conflict_do_update(
            index_elements=[ProxyChoice.player_id, ProxyChoice.discord_channel_id],
            set_={"entity_id": entity.id},
        )
    )
    await db.execute(stmt)
    await db.commit()
    return await proxy_context(body.guild_id, body.discord_channel_id, body.player_id, db)


# ---------- карточка проекта ----------
@router.get("/projects", response_model=list[ProjectBriefOut])
async def guild_projects(guild_id: int, db: AsyncSession = Depends(get_db)):
    """Проекты сервера — для автодополнения аргумента /about."""
    result = await db.execute(
        select(Project).where(Project.guild_id == guild_id).order_by(Project.label)
    )
    return [
        ProjectBriefOut(project_id=p.id, label=p.label) for p in result.scalars().all()
    ]


@router.get("/about", response_model=AboutProjectOut)
async def about_project(
    guild_id: int,
    channel_id: int | None = None,
    project_id: int | None = None,
    db: AsyncSession = Depends(get_db),
) -> AboutProjectOut:
    """Карточка проекта. Проект выбран явно — берём его, иначе определяем по каналу."""
    if project_id is not None:
        project = await db.get(Project, project_id)
        # Сверяем сервер: иначе с одного сервера читались бы чужие проекты.
        if project is None or project.guild_id != guild_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Проект не найден на этом сервере"
            )
    else:
        project = await _resolve_project(guild_id, channel_id, db)

    return AboutProjectOut(
        project_id=project.id,
        label=project.label,
        type=project.type,
        desc=project.desc,
        authors=project.authors,
        media_url=project.media_url,
        media_filename=project.media_filename,
        media_content_type=project.media_content_type,
    )


# ---------- регистрация ----------
@router.get("/forms/open", response_model=RegistrationFormOut)
async def open_form(
    guild_id: int, channel_id: int | None = None, db: AsyncSession = Depends(get_db)
) -> RegistrationForm:
    """Открытая форма регистрации проекта (для команды /register)."""
    project = await _resolve_project(guild_id, channel_id, db)
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
