from __future__ import annotations

from datetime import datetime
from typing import Any
from typing import Optional

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

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
class ProjectBase(BaseModel):
    label: str
    type: str = ""
    desc: str = ""
    guild_id: Optional[int] = None


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    label: Optional[str] = None
    type: Optional[str] = None
    desc: Optional[str] = None
    guild_id: Optional[int] = None


class ProjectOut(ORMModel):
    id: int
    label: str
    type: str
    desc: str
    guild_id: Optional[int]
    created_at: datetime


# ---------- channel ----------
class ChannelBase(BaseModel):
    channel_id: int
    channel_type: str = ""
    label: str = ""


class ChannelCreate(ChannelBase):
    pass


class ChannelUpdate(BaseModel):
    channel_id: Optional[int] = None
    channel_type: Optional[str] = None
    label: Optional[str] = None


class ChannelOut(ORMModel):
    id: int
    project_id: int
    channel_id: int
    channel_type: str
    label: str


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
    parent_id: Optional[int] = None
    attributes: dict[str, Any] = Field(default_factory=dict)


class EntityCreate(EntityBase):
    pass


class EntityUpdate(BaseModel):
    label: Optional[str] = None
    type_id: Optional[int] = None
    picture: Optional[str] = None
    parent_id: Optional[int] = None
    attributes: Optional[dict[str, Any]] = None


class AssignmentOut(ORMModel):
    id: int
    player_id: Optional[int]


class EntityOut(ORMModel):
    id: int
    project_id: int
    type_id: Optional[int]
    label: str
    picture: str
    parent_id: Optional[int]
    attributes: dict[str, Any]
    assignment: Optional[AssignmentOut] = None


class AssignPlayerRequest(BaseModel):
    player_id: Optional[int] = None  # None снимает закрепление


# ---------- template preview ----------
class TemplatePreviewRequest(BaseModel):
    template: str
    attributes: dict[str, Any] = Field(default_factory=dict)
    label: str = ""


class TemplatePreviewResponse(BaseModel):
    rendered: str
    error: Optional[str] = None


# ---------- post (верд) ----------
class EntityEdit(BaseModel):
    entity_id: int
    attributes: dict[str, Any]


class PostBase(BaseModel):
    title: str = ""
    channel_id: Optional[int] = None
    target_channel_id: Optional[int] = None
    content: str = ""
    attachments: list[Any] = Field(default_factory=list)
    entity_edits: list[EntityEdit] = Field(default_factory=list)
    reply_to: Optional[int] = None
    scheduled_at: Optional[datetime] = None
    created_by: str = ""
    author_name: str = ""
    author_avatar_url: str = ""
    use_embed: bool = False
    embed_image_url: str = ""
    embed_color: str = ""


class PostCreate(PostBase):
    pass


class PostUpdate(BaseModel):
    title: Optional[str] = None
    channel_id: Optional[int] = None
    target_channel_id: Optional[int] = None
    content: Optional[str] = None
    attachments: Optional[list[Any]] = None
    entity_edits: Optional[list[EntityEdit]] = None
    reply_to: Optional[int] = None
    scheduled_at: Optional[datetime] = None
    updated_by: Optional[str] = None
    author_name: Optional[str] = None
    author_avatar_url: Optional[str] = None
    use_embed: Optional[bool] = None
    embed_image_url: Optional[str] = None
    embed_color: Optional[str] = None


class PostOut(ORMModel):
    id: int
    project_id: int
    channel_id: Optional[int]
    target_channel_id: Optional[int]
    title: str
    status: PostStatus
    content: str
    attachments: list[Any]
    entity_edits: list[Any]
    reply_to: Optional[int]
    scheduled_at: Optional[datetime]
    published_at: Optional[datetime]
    published_message_id: Optional[int]
    created_by: str
    created_at: datetime
    updated_by: str
    updated_at: datetime
    author_name: str
    author_avatar_url: str
    use_embed: bool
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
    discord_user_id: int
    discord_username: str = ""
    answers: dict[str, Any] = Field(default_factory=dict)


class RegistrationOut(ORMModel):
    id: int
    form_id: int
    project_id: int
    discord_user_id: int
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
    player_id: Optional[int]
    discord_channel_id: Optional[int]
    is_read: bool
    created_at: datetime


# ---------- internal (bot) ----------
class WebhookIn(BaseModel):
    discord_channel_id: int
    webhook_id: int
    webhook_token: str
    webhook_url: str
    project_id: Optional[int] = None


class WebhookOut(ORMModel):
    discord_channel_id: int
    webhook_id: int
    webhook_token: str
    webhook_url: str


class DeliveredIn(BaseModel):
    message_id: int


class PingIn(BaseModel):
    guild_id: int
    player_id: int
    discord_channel_id: Optional[int] = None
    message: str = ""


class MeInfoOut(BaseModel):
    entity_id: int
    label: str
    rendered: str


class PendingPostOut(BaseModel):
    id: int
    project_id: int
    target_channel_id: Optional[int]
    content: str
    title: str
    use_embed: bool
    embed_image_url: str
    embed_color: str
    author_name: str
    author_avatar_url: str
