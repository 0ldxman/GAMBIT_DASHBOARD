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
from sqlalchemy import UniqueConstraint
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
    # Discord-сервер. НЕ уникален: на одном сервере может жить несколько проектов,
    # каждый владеет своими категориями (см. ProjectChannel).
    guild_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    channels: Mapped[list[ProjectChannel]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    roles: Mapped[list[ProjectRole]] = relationship(
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
    # Категория-родитель в Discord. По ней проект «владеет» всеми каналами внутри:
    # бот так понимает, к какому проекту относится команда на мультипроектном сервере.
    discord_parent_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    project: Mapped[Project] = relationship(back_populates="channels")


class AccessLevel(str, enum.Enum):
    """Что роль сервера значит внутри проекта."""

    admin = "admin"          # полный доступ, видит все каналы проекта
    moderator = "moderator"  # помощник мастера, тоже видит все каналы
    player = "player"        # обычный игрок: каналы получает через свои сущности


class ProjectRole(Base):
    """Роль Discord-сервера, наделённая правами внутри проекта.

    Список вместо двух жёстких полей: у игры может быть несколько ролей мастеров
    (главмастер, модератор экономики) и несколько игроцких.
    """

    __tablename__ = "project_role"
    __table_args__ = (UniqueConstraint("project_id", "role_id", name="uq_project_role"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    role_id: Mapped[int] = mapped_column(BigInteger)  # Discord snowflake
    name: Mapped[str] = mapped_column(String(200), default="")  # кэш имени роли
    access_level: Mapped[AccessLevel] = mapped_column(
        SAEnum(AccessLevel, name="access_level"), default=AccessLevel.player
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    project: Mapped[Project] = relationship(back_populates="roles")


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
    # Свободный key-value JSON. Значения подставляются в attributes_template типа.
    attributes: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    project: Mapped[Project] = relationship(back_populates="entities")
    type: Mapped[Optional[EntityType]] = relationship(back_populates="entities")
    members: Mapped[list[EntityMember]] = relationship(
        back_populates="entity", cascade="all, delete-orphan"
    )
    channels: Mapped[list[EntityChannel]] = relationship(
        back_populates="entity", cascade="all, delete-orphan"
    )
    # Связи с другими сущностями (см. EntityRelation).
    relations_out: Mapped[list[EntityRelation]] = relationship(
        back_populates="parent",
        foreign_keys="EntityRelation.parent_id",
        cascade="all, delete-orphan",
    )
    relations_in: Mapped[list[EntityRelation]] = relationship(
        back_populates="child",
        foreign_keys="EntityRelation.child_id",
        cascade="all, delete-orphan",
    )


class EntityMember(Base):
    """Игрок на сущности с ролью.

    Сущностью могут управлять несколько игроков одновременно (лидер, глава партии
    и т.д.). Один из них помечается основным — смена лидера = перенос is_primary.
    """

    __tablename__ = "entity_member"
    __table_args__ = (UniqueConstraint("entity_id", "player_id", name="uq_entity_member"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entity.id", ondelete="CASCADE"))
    player_id: Mapped[int] = mapped_column(BigInteger)  # Discord user id
    role: Mapped[str] = mapped_column(String(120), default="")
    is_primary: Mapped[bool] = mapped_column(default=False)
    # Кэш профиля из Discord, чтобы показывать игрока не голым ID.
    player_name: Mapped[str] = mapped_column(String(120), default="")
    player_avatar_url: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    entity: Mapped[Entity] = relationship(back_populates="members")


class EntityRelation(Base):
    """Связь между сущностями с характером связи.

    Отдельная таблица вместо parent_id: сущность может входить сразу в несколько
    родителей (страна — и в блок, и в организацию), а тип связи описывает её смысл.
    """

    __tablename__ = "entity_relation"
    __table_args__ = (
        UniqueConstraint("parent_id", "child_id", "relation_type", name="uq_entity_relation"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    parent_id: Mapped[int] = mapped_column(ForeignKey("entity.id", ondelete="CASCADE"))
    child_id: Mapped[int] = mapped_column(ForeignKey("entity.id", ondelete="CASCADE"))
    # Напр.: "состав", "член организации", "вассал", "подразделение".
    relation_type: Mapped[str] = mapped_column(String(120), default="состав")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    parent: Mapped[Entity] = relationship(back_populates="relations_out", foreign_keys=[parent_id])
    child: Mapped[Entity] = relationship(back_populates="relations_in", foreign_keys=[child_id])


class EntityChannel(Base):
    """Привязка Discord-канала к сущности.

    Много-ко-многим: канал организации связывается сразу с несколькими странами.
    При sync_access доступ к каналу пересчитывается по участникам ВСЕХ связанных
    сущностей — поэтому снятие игрока с одной сущности не выкидывает его из канала,
    если он остаётся участником другой.
    """

    __tablename__ = "entity_channel"
    __table_args__ = (
        UniqueConstraint("entity_id", "discord_channel_id", name="uq_entity_channel"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entity.id", ondelete="CASCADE"))
    discord_channel_id: Mapped[int] = mapped_column(BigInteger)
    label: Mapped[str] = mapped_column(String(200), default="")
    sync_access: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    entity: Mapped[Entity] = relationship(back_populates="channels")


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
