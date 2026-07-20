from __future__ import annotations

from datetime import datetime
from typing import Any
from typing import Optional

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from app.fields import DiscordId
from app.models import AccessLevel
from app.models import NotificationType
from app.models import PostStatus
from app.models import RegistrationStatus


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- auth ----------
class LoginRequest(BaseModel):
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ---------- project ----------
class ProjectCreate(BaseModel):
    label: str
    type: str = ""
    desc: str = ""
    guild_id: Optional[DiscordId] = None
    # Категории сервера, которыми владеет проект. Всё внутри них — его каналы.
    category_ids: list[DiscordId] = Field(default_factory=list)


class ProjectUpdate(BaseModel):
    label: Optional[str] = None
    type: Optional[str] = None
    desc: Optional[str] = None
    guild_id: Optional[DiscordId] = None
    # Полная замена списка категорий; None — не трогать.
    category_ids: Optional[list[DiscordId]] = None


class ProjectOut(ORMModel):
    id: int
    label: str
    type: str
    desc: str
    guild_id: Optional[DiscordId]
    created_at: datetime


# ---------- роли проекта ----------
class ProjectRoleOut(ORMModel):
    id: int
    project_id: int
    role_id: DiscordId
    name: str
    access_level: AccessLevel


class ProjectRoleCreate(BaseModel):
    role_id: DiscordId
    name: str = ""
    access_level: AccessLevel = AccessLevel.player


class ProjectRoleUpdate(BaseModel):
    access_level: Optional[AccessLevel] = None


# ---------- channel ----------
class ChannelBase(BaseModel):
    channel_id: DiscordId
    channel_type: str = ""
    label: str = ""
    discord_parent_id: Optional[DiscordId] = None


class ChannelCreate(ChannelBase):
    pass


class ChannelUpdate(BaseModel):
    channel_id: Optional[DiscordId] = None
    channel_type: Optional[str] = None
    label: Optional[str] = None


class ChannelOut(ORMModel):
    id: int
    project_id: int
    channel_id: DiscordId
    channel_type: str
    label: str
    discord_parent_id: Optional[DiscordId]


# ---------- entity type ----------
class EntityTypeBase(BaseModel):
    slug: str
    label: str
    attributes_template: str = ""


class EntityTypeCreate(EntityTypeBase):
    pass


class EntityTypeUpdate(BaseModel):
    slug: Optional[str] = None
    label: Optional[str] = None
    attributes_template: Optional[str] = None


class EntityTypeOut(ORMModel):
    id: int
    project_id: int
    slug: str
    label: str
    attributes_template: str


# ---------- entity ----------
class EntityBase(BaseModel):
    label: str
    type_id: Optional[int] = None
    picture: str = ""
    attributes: dict[str, Any] = Field(default_factory=dict)


class EntityCreate(EntityBase):
    pass


class EntityUpdate(BaseModel):
    label: Optional[str] = None
    type_id: Optional[int] = None
    picture: Optional[str] = None
    attributes: Optional[dict[str, Any]] = None


# ---------- участники сущности ----------
class MemberOut(ORMModel):
    id: int
    entity_id: int
    player_id: DiscordId
    role: str
    is_primary: bool
    player_name: str
    player_avatar_url: str


class MemberCreate(BaseModel):
    player_id: DiscordId
    role: str = ""
    is_primary: bool = False


class MemberUpdate(BaseModel):
    role: Optional[str] = None
    is_primary: Optional[bool] = None


# ---------- связи сущностей ----------
class RelationOut(ORMModel):
    id: int
    parent_id: int
    child_id: int
    relation_type: str


class RelationCreate(BaseModel):
    # Направление: parent → child. Указывается вторая сторона и её роль в связи.
    child_id: int
    relation_type: str = "состав"


# ---------- каналы сущности ----------
class EntityChannelOut(ORMModel):
    id: int
    entity_id: int
    discord_channel_id: DiscordId
    label: str
    sync_access: bool


class EntityChannelCreate(BaseModel):
    discord_channel_id: DiscordId
    label: str = ""
    sync_access: bool = True


class EntityChannelUpdate(BaseModel):
    label: Optional[str] = None
    sync_access: Optional[bool] = None


class EntityOut(ORMModel):
    id: int
    project_id: int
    type_id: Optional[int]
    label: str
    picture: str
    attributes: dict[str, Any]
    members: list[MemberOut] = Field(default_factory=list)


# ---------- discord справочники ----------
class DiscordGuildOut(BaseModel):
    guild_id: str
    name: str
    icon_url: Optional[str] = None


class DiscordChannelOut(BaseModel):
    channel_id: str  # snowflake строкой
    name: str
    type: str
    position: int
    parent_id: Optional[str] = None
    parent_name: Optional[str] = None


class DiscordRoleOut(BaseModel):
    role_id: str
    name: str
    position: int


class CreateChannelRequest(BaseModel):
    name: str
    channel_type: str = "text"
    parent_id: Optional[DiscordId] = None  # категория
    private: bool = False
    # Сразу привязать созданный канал к сущности (и выдать доступ её игрокам).
    entity_id: Optional[int] = None
    register_channel: bool = True  # добавить в список каналов проекта


class DiscordMemberOut(BaseModel):
    player_id: str
    name: str
    avatar_url: str


# ---------- дерево каналов проекта ----------
class EntityLinkOut(BaseModel):
    """Какая сущность имеет доступ к каналу (для экрана канала)."""

    link_id: int
    entity_id: int
    entity_label: str
    sync_access: bool


class ChannelNodeOut(BaseModel):
    channel_id: str
    name: str
    type: str
    position: int
    # id строки project_channel, если канал зарегистрирован в проекте отдельно.
    registered_id: Optional[int] = None
    entities: list[EntityLinkOut] = Field(default_factory=list)


class CategoryNodeOut(BaseModel):
    id: int  # project_channel.id самой категории
    channel_id: str
    name: str
    # Категории уже нет на сервере — её удалили в Discord мимо дашборда.
    missing: bool = False
    channels: list[ChannelNodeOut] = Field(default_factory=list)


class ChannelTreeOut(BaseModel):
    categories: list[CategoryNodeOut] = Field(default_factory=list)
    # Каналы, зарегистрированные явно, но лежащие вне категорий проекта.
    loose: list[ChannelNodeOut] = Field(default_factory=list)
    # Discord недоступен — дерево строится только из того, что знает БД.
    error: Optional[str] = None


# ---------- template preview ----------
class TemplatePreviewRequest(BaseModel):
    template: str
    attributes: dict[str, Any] = Field(default_factory=dict)
    label: str = ""


class TemplatePreviewResponse(BaseModel):
    rendered: str
    error: Optional[str] = None


# ---------- post (верд) ----------
class EntityEditOp(BaseModel):
    """Одна операция над атрибутом сущности.

    mode:
      set    — записать value как есть (число/строка/список/объект)
      expr   — вычислить арифметику по атрибутам, напр. "ВС.людские_ресурсы - 10"
      delete — удалить атрибут
    """

    path: str  # dot-path, напр. "ВС.людские_ресурсы"
    mode: str = "set"
    value: Any = None


class EntityEdit(BaseModel):
    entity_id: int
    # Новый формат — список операций.
    ops: list[EntityEditOp] = Field(default_factory=list)
    # Прежний формат (плоский/вложенный патч) — поддерживается для старых вердов.
    attributes: dict[str, Any] = Field(default_factory=dict)


class AttachmentOut(BaseModel):
    url: str
    filename: str
    size: int
    content_type: str


class PostBase(BaseModel):
    title: str = ""
    channel_id: Optional[int] = None
    target_channel_id: Optional[DiscordId] = None
    content: str = ""
    attachments: list[Any] = Field(default_factory=list)
    entity_edits: list[EntityEdit] = Field(default_factory=list)
    reply_to: Optional[int] = None
    scheduled_at: Optional[datetime] = None
    created_by: str = ""
    author_name: str = ""
    author_avatar_url: str = ""
    use_embed: bool = False
    embed_title: str = ""
    embed_description: str = ""
    embed_image_url: str = ""
    embed_color: str = ""


class PostCreate(PostBase):
    pass


class PostUpdate(BaseModel):
    title: Optional[str] = None
    channel_id: Optional[int] = None
    target_channel_id: Optional[DiscordId] = None
    content: Optional[str] = None
    attachments: Optional[list[Any]] = None
    entity_edits: Optional[list[EntityEdit]] = None
    reply_to: Optional[int] = None
    scheduled_at: Optional[datetime] = None
    updated_by: Optional[str] = None
    author_name: Optional[str] = None
    author_avatar_url: Optional[str] = None
    use_embed: Optional[bool] = None
    embed_title: Optional[str] = None
    embed_description: Optional[str] = None
    embed_image_url: Optional[str] = None
    embed_color: Optional[str] = None


class PostOut(ORMModel):
    id: int
    project_id: int
    channel_id: Optional[int]
    target_channel_id: Optional[DiscordId]
    title: str
    status: PostStatus
    content: str
    attachments: list[Any]
    entity_edits: list[Any]
    reply_to: Optional[int]
    scheduled_at: Optional[datetime]
    published_at: Optional[datetime]
    published_message_id: Optional[DiscordId]
    created_by: str
    created_at: datetime
    updated_by: str
    updated_at: datetime
    author_name: str
    author_avatar_url: str
    use_embed: bool
    embed_title: str
    embed_description: str
    embed_image_url: str
    embed_color: str


# ---------- registration form ----------
class FormField(BaseModel):
    key: str
    label: str
    type: str = "text"  # text | paragraph | number | select
    required: bool = False
    options: list[str] = Field(default_factory=list)


class RegistrationFormBase(BaseModel):
    title: str = "Регистрация"
    description: str = ""
    is_open: bool = True
    fields: list[FormField] = Field(default_factory=list)


class RegistrationFormCreate(RegistrationFormBase):
    pass


class RegistrationFormUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    is_open: Optional[bool] = None
    fields: Optional[list[FormField]] = None


class RegistrationFormOut(ORMModel):
    id: int
    project_id: int
    title: str
    description: str
    is_open: bool
    fields: list[Any]
    created_at: datetime


# ---------- registration (заявка) ----------
class RegistrationCreate(BaseModel):
    form_id: int
    discord_user_id: DiscordId
    discord_username: str = ""
    answers: dict[str, Any] = Field(default_factory=dict)


class RegistrationOut(ORMModel):
    id: int
    form_id: int
    project_id: int
    discord_user_id: DiscordId
    discord_username: str
    answers: dict[str, Any]
    status: RegistrationStatus
    entity_id: Optional[int]
    reviewed_by: str
    reviewed_at: Optional[datetime]
    created_at: datetime


class RegistrationReview(BaseModel):
    # При approve можно сразу создать сущность указанного типа и закрепить игрока.
    create_entity: bool = False
    entity_label: str = ""
    entity_type_id: Optional[int] = None


# ---------- notification ----------
class NotificationOut(ORMModel):
    id: int
    project_id: int
    type: NotificationType
    message: str
    entity_id: Optional[int]
    player_id: Optional[DiscordId]
    discord_channel_id: Optional[DiscordId]
    is_read: bool
    created_at: datetime


class EntityPingCount(BaseModel):
    """Сколько непрочитанных пингов пришло по сущности — для колокольчика в списке."""

    entity_id: int
    unread: int


# ---------- internal (bot) ----------
class WebhookIn(BaseModel):
    discord_channel_id: DiscordId
    webhook_id: DiscordId
    webhook_token: str
    webhook_url: str
    project_id: Optional[int] = None


class WebhookOut(ORMModel):
    discord_channel_id: DiscordId
    webhook_id: DiscordId
    webhook_token: str
    webhook_url: str


class DeliveredIn(BaseModel):
    message_id: DiscordId


class PingIn(BaseModel):
    guild_id: DiscordId
    player_id: DiscordId
    discord_channel_id: Optional[DiscordId] = None
    message: str = ""


class MeInfoOut(BaseModel):
    entity_id: int
    label: str
    rendered: str


class PendingPostOut(BaseModel):
    id: int
    project_id: int
    target_channel_id: Optional[DiscordId]
    content: str
    title: str
    use_embed: bool
    embed_title: str
    embed_description: str
    embed_image_url: str
    embed_color: str
    author_name: str
    author_avatar_url: str
    attachments: list[Any] = Field(default_factory=list)
