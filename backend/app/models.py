from __future__ import annotations

import enum
from datetime import datetime
from typing import Any
from typing import Optional

from sqlalchemy import BigInteger
from sqlalchemy import DateTime
from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey
from sqlalchemy import String
from sqlalchemy import Text
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship

from app.database import Base


class PostStatus(str, enum.Enum):
    draft = "draft"
    scheduled = "scheduled"
    published = "published"


class RegistrationStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class NotificationType(str, enum.Enum):
    ping = "ping"            # игрок пингует мастера
    registration = "registration"  # новая заявка на регистрацию
    system = "system"


class Project(Base):
    """Игра (проект)."""

    __tablename__ = "project"

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(100), default="")
    desc: Mapped[str] = mapped_column(Text, default="")
    # Discord-сервер проекта: по нему бот определяет проект для команд/пингов/форм.
    guild_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    channels: Mapped[list[ProjectChannel]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    entity_types: Mapped[list[EntityType]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    entities: Mapped[list[Entity]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    posts: Mapped[list[Post]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class ProjectChannel(Base):
    """Привязка Discord-канала/категории к проекту."""

    __tablename__ = "project_channel"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    channel_id: Mapped[int] = mapped_column(BigInteger)  # Discord snowflake
    channel_type: Mapped[str] = mapped_column(String(50), default="")
    label: Mapped[str] = mapped_column(String(200), default="")

    project: Mapped[Project] = relationship(back_populates="channels")


class EntityType(Base):
    """Тип сущности проекта с шаблоном embed для отображения атрибутов."""

    __tablename__ = "entity_type"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    slug: Mapped[str] = mapped_column(String(100))
    label: Mapped[str] = mapped_column(String(200))
    # Jinja2-шаблон текста embed (напр. для /me-info). Значения из entity.attributes.
    attributes_template: Mapped[str] = mapped_column(Text, default="")

    project: Mapped[Project] = relationship(back_populates="entity_types")
    entities: Mapped[list[Entity]] = relationship(back_populates="type")


class Entity(Base):
    """Сущность игры: фракция/страна/юнит/персонаж/локация."""

    __tablename__ = "entity"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    type_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("entity_type.id", ondelete="SET NULL"), nullable=True
    )
    label: Mapped[str] = mapped_column(String(200))
    picture: Mapped[str] = mapped_column(String(500), default="")
    parent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("entity.id", ondelete="SET NULL"), nullable=True
    )
    # Свободный key-value JSON. Значения подставляются в attributes_template типа.
    attributes: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    project: Mapped[Project] = relationship(back_populates="entities")
    type: Mapped[Optional[EntityType]] = relationship(back_populates="entities")
    parent: Mapped[Optional[Entity]] = relationship(
        remote_side="Entity.id", back_populates="children"
    )
    children: Mapped[list[Entity]] = relationship(back_populates="parent")
    assignment: Mapped[Optional[ProjectEntity]] = relationship(
        back_populates="entity", cascade="all, delete-orphan", uselist=False
    )


class ProjectEntity(Base):
    """Закрепление сущности за игроком (Discord user id)."""

    __tablename__ = "project_entity"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    entity_id: Mapped[int] = mapped_column(
        ForeignKey("entity.id", ondelete="CASCADE"), unique=True
    )
    player_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)  # Discord user id
    # Кэш профиля из Discord, чтобы показывать игрока не голым ID.
    player_name: Mapped[str] = mapped_column(String(120), default="")
    player_avatar_url: Mapped[str] = mapped_column(String(500), default="")

    entity: Mapped[Entity] = relationship(back_populates="assignment")


class Post(Base):
    """«Верд» — мастерский пост-сводка, применяющий правки сущностей при публикации."""

    __tablename__ = "project_post"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    channel_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("project_channel.id", ondelete="SET NULL"), nullable=True
    )
    # Прямой Discord channel_id для отправки через вебхук (любой канал).
    target_channel_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    title: Mapped[str] = mapped_column(String(300), default="")
    status: Mapped[PostStatus] = mapped_column(
        SAEnum(PostStatus, name="post_status"), default=PostStatus.draft
    )
    content: Mapped[str] = mapped_column(Text, default="")
    attachments: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    # Список правок: [{"entity_id": int, "attributes": {ключ: значение}}]
    entity_edits: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    reply_to: Mapped[Optional[int]] = mapped_column(
        ForeignKey("project_post.id", ondelete="SET NULL"), nullable=True
    )

    # Идентичность вебхука + author эмбеда.
    author_name: Mapped[str] = mapped_column(String(200), default="")
    author_avatar_url: Mapped[str] = mapped_column(String(500), default="")
    # Формат: content шлётся как текст сообщения; при use_embed добавляется эмбед
    # со СВОИМИ заголовком и описанием (title — внутреннее имя верда для дашборда).
    use_embed: Mapped[bool] = mapped_column(default=False)
    embed_title: Mapped[str] = mapped_column(String(300), default="")
    embed_description: Mapped[str] = mapped_column(Text, default="")
    embed_image_url: Mapped[str] = mapped_column(String(500), default="")
    embed_color: Mapped[str] = mapped_column(String(20), default="")  # hex, напр. "#5865F2"

    scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    published_message_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    created_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_by: Mapped[str] = mapped_column(String(120), default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped[Project] = relationship(back_populates="posts")


class ChannelWebhook(Base):
    """Кэш вебхуков по Discord-каналам. Бот создаёт вебхук и переиспользует его."""

    __tablename__ = "channel_webhook"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("project.id", ondelete="SET NULL"), nullable=True
    )
    discord_channel_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    webhook_id: Mapped[int] = mapped_column(BigInteger)
    webhook_token: Mapped[str] = mapped_column(String(200))
    webhook_url: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RegistrationForm(Base):
    """Форма регистрации на проект, конструируется мастером."""

    __tablename__ = "registration_form"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200), default="Регистрация")
    description: Mapped[str] = mapped_column(Text, default="")
    is_open: Mapped[bool] = mapped_column(default=True)
    # Поля формы: [{"key","label","type":"text|number|select|paragraph","required":bool,"options":[...]}]
    fields: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    registrations: Mapped[list[Registration]] = relationship(
        back_populates="form", cascade="all, delete-orphan"
    )


class Registration(Base):
    """Заявка игрока по форме регистрации."""

    __tablename__ = "registration"

    id: Mapped[int] = mapped_column(primary_key=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("registration_form.id", ondelete="CASCADE"))
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    discord_user_id: Mapped[int] = mapped_column(BigInteger)
    discord_username: Mapped[str] = mapped_column(String(120), default="")
    answers: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[RegistrationStatus] = mapped_column(
        SAEnum(RegistrationStatus, name="registration_status"),
        default=RegistrationStatus.pending,
    )
    # Сущность, созданная/привязанная при одобрении.
    entity_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("entity.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_by: Mapped[str] = mapped_column(String(120), default="")
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    form: Mapped[RegistrationForm] = relationship(back_populates="registrations")


class Notification(Base):
    """Уведомление для мастеров (пинг игрока, новая заявка и т.п.)."""

    __tablename__ = "notification"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    type: Mapped[NotificationType] = mapped_column(
        SAEnum(NotificationType, name="notification_type"),
        default=NotificationType.system,
    )
    message: Mapped[str] = mapped_column(Text, default="")
    entity_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("entity.id", ondelete="SET NULL"), nullable=True
    )
    player_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)  # Discord user id
    discord_channel_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    is_read: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
