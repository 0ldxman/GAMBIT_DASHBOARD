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
    authors: str = ""
    guild_id: Optional[DiscordId] = None
    # Категории сервера, которыми владеет проект. Всё внутри них — его каналы.
    category_ids: list[DiscordId] = Field(default_factory=list)


class ProjectUpdate(BaseModel):
    label: Optional[str] = None
    type: Optional[str] = None
    desc: Optional[str] = None
    authors: Optional[str] = None
    guild_id: Optional[DiscordId] = None
    # Вложение эмбеда /about; пустая строка снимает его.
    media_url: Optional[str] = None
    media_filename: Optional[str] = None
    media_content_type: Optional[str] = None
    # Полная замена списка категорий; None — не трогать.
    category_ids: Optional[list[DiscordId]] = None


class ProjectOut(ORMModel):
    id: int
    label: str
    type: str
    desc: str
    authors: str
    guild_id: Optional[DiscordId]
    media_url: str
    media_filename: str
    media_content_type: str
    # Текущий номер хода: растёт при «Завершить ход», падает при откате.
    turn_number: int = 0
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
class ComputedFieldIn(BaseModel):
    """Вычисляемое поле: путь в дереве формул, подпись и выражение."""

    path: str  # dot-path, напр. "бюджет.ресурсы.минералы"
    label: str = ""
    expr: str


class ComputedValueOut(BaseModel):
    """Значение формулы для конкретной сущности."""

    path: str
    label: str
    # Готовый к показу текст («12 400»); ошибка — вместо него.
    text: str = ""
    error: Optional[str] = None
    # "type" — формула типа, "entity" — своя у сущности, "override" — своя
    # вместо типовой. Дашборд по этому полю подписывает строку.
    source: str = ""


class TurnRuleIn(BaseModel):
    """Правило автоизменения в конце хода: атрибут ← выражение.

    `path` — куда записать (dot-path атрибута, напр. «экономика.деньги.запас»),
    `expr` — что записать (напр. «экономика.деньги.запас - выч.деньги»).
    Форма совпадает с формулой, но смысл иной: формула считается на лету, а
    правило хода один раз применяется к атрибутам при завершении хода.
    """

    path: str
    label: str = ""
    expr: str


class ExprEvalRequest(BaseModel):
    """Проверить одно выражение на данных конкретной сущности (живой предпросмотр)."""

    expr: str


class ExprEvalRef(BaseModel):
    """Значение пути, на который ссылается выражение — чтобы куратор видел вход."""

    path: str
    text: str


class ExprEvalOut(BaseModel):
    value: Optional[str] = None
    error: Optional[str] = None
    refs: list[ExprEvalRef] = Field(default_factory=list)


class EntityTypeBase(BaseModel):
    slug: str
    label: str
    attributes_template: str = ""
    # Страницы описания: каждая уходит отдельным эмбедом. Пусто — используется
    # attributes_template как единственная страница (типы до появления страниц).
    description_pages: list[str] = Field(default_factory=list)
    # Цвет полосы эмбеда для каждой страницы: «#5865F2» либо пусто.
    page_colors: list[str] = Field(default_factory=list)
    # Структура атрибутов по умолчанию — с неё начинается новая сущность типа.
    attributes_schema: dict[str, Any] = Field(default_factory=dict)
    # Формулы от атрибутов, доступные в шаблоне как {{ выч.путь }}.
    computed: list[ComputedFieldIn] = Field(default_factory=list)
    # Автоизменения атрибутов при завершении хода.
    turn_rules: list[TurnRuleIn] = Field(default_factory=list)


class EntityTypeCreate(EntityTypeBase):
    pass


class EntityTypeUpdate(BaseModel):
    slug: Optional[str] = None
    label: Optional[str] = None
    attributes_template: Optional[str] = None
    description_pages: Optional[list[str]] = None
    page_colors: Optional[list[str]] = None
    attributes_schema: Optional[dict[str, Any]] = None
    computed: Optional[list[ComputedFieldIn]] = None
    turn_rules: Optional[list[TurnRuleIn]] = None


class EntityTypeOut(ORMModel):
    id: int
    project_id: int
    slug: str
    label: str
    attributes_template: str
    description_pages: list[str] = Field(default_factory=list)
    page_colors: list[str] = Field(default_factory=list)
    attributes_schema: dict[str, Any] = Field(default_factory=dict)
    computed: list[ComputedFieldIn] = Field(default_factory=list)
    turn_rules: list[TurnRuleIn] = Field(default_factory=list)


# ---------- entity ----------
class EntityBase(BaseModel):
    label: str
    type_id: Optional[int] = None
    picture: str = ""
    attributes: dict[str, Any] = Field(default_factory=dict)
    # Особое описание замещает страницы типа целиком.
    use_custom_description: bool = False
    description_pages: list[str] = Field(default_factory=list)
    page_colors: list[str] = Field(default_factory=list)
    # Собственные формулы: дополняют формулы типа, совпадение путей — переопределяет.
    computed: list[ComputedFieldIn] = Field(default_factory=list)
    # Собственные правила хода: дополняют правила типа, совпадение путей — переопределяет.
    turn_rules: list[TurnRuleIn] = Field(default_factory=list)


class EntityCreate(EntityBase):
    pass


class EntityUpdate(BaseModel):
    label: Optional[str] = None
    type_id: Optional[int] = None
    picture: Optional[str] = None
    attributes: Optional[dict[str, Any]] = None
    use_custom_description: Optional[bool] = None
    description_pages: Optional[list[str]] = None
    page_colors: Optional[list[str]] = None
    computed: Optional[list[ComputedFieldIn]] = None
    turn_rules: Optional[list[TurnRuleIn]] = None


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
    directed: bool


class RelationCreate(BaseModel):
    """Связь со второй стороной.

    `directed=False` (по умолчанию) — стороны равны: «союзник», «война».
    `directed=True` — иерархия parent → child: «состав», «вассал».
    """

    child_id: int
    relation_type: str = "союзник"
    directed: bool = False


class RelationUpdate(BaseModel):
    relation_type: Optional[str] = None
    directed: Optional[bool] = None


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
    use_custom_description: bool = False
    description_pages: list[str] = Field(default_factory=list)
    page_colors: list[str] = Field(default_factory=list)
    computed: list[ComputedFieldIn] = Field(default_factory=list)
    turn_rules: list[TurnRuleIn] = Field(default_factory=list)
    members: list[MemberOut] = Field(default_factory=list)


# ---------- discord справочники ----------
class DiscordGuildOut(BaseModel):
    guild_id: str
    name: str
    icon_url: Optional[str] = None
    # Приблизительное число участников — так его отдаёт Discord.
    member_count: Optional[int] = None
    project_count: int = 0


class ProjectStats(BaseModel):
    """Сводка по проекту для карточки."""

    project_id: int
    entity_count: int
    # Уникальные игроки, закреплённые за сущностями проекта.
    player_count: int




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


class GuildPlayerOut(DiscordMemberOut):
    """Участник сервера, имеющий роль проекта — для выбора игрока из списка."""

    role_names: list[str] = Field(default_factory=list)


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
    # Сообщения игроков подменяются вебхуком от лица их сущности.
    auto_proxy: bool = False


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


# ---------- предпросмотр описаний ----------
class TemplatePagesRequest(BaseModel):
    pages: list[str] = Field(default_factory=list)
    page_colors: list[str] = Field(default_factory=list)
    attributes: dict[str, Any] = Field(default_factory=dict)
    label: str = ""
    # Чья это карточка. Задана — особые переменные (игроки, связи) берутся у
    # настоящей сущности; пусто — подставляется пример, чтобы в редакторе типа
    # было видно, как ляжет вёрстка.
    entity_id: Optional[int] = None
    # Формулы типа: считаются на этих же атрибутах и подставляются в страницы.
    computed: list[ComputedFieldIn] = Field(default_factory=list)
    # Собственные формулы сущности. Сливаются с типовыми на стороне сервера,
    # чтобы правило слияния было одно и то же в предпросмотре и в Discord.
    computed_own: list[ComputedFieldIn] = Field(default_factory=list)


class RenderedPage(BaseModel):
    rendered: str
    # Цвет полосы эмбеда этой страницы; пусто — цвет по умолчанию.
    color: str = ""
    # Длина готового текста — она и упирается в лимит эмбеда, а не длина шаблона.
    length: int
    over_limit: bool


class TemplatePagesResponse(BaseModel):
    pages: list[RenderedPage] = Field(default_factory=list)
    limit: int
    error: Optional[str] = None
    computed: list[ComputedValueOut] = Field(default_factory=list)


# ---------- предпросмотр правок верда ----------
class EditPreviewRow(BaseModel):
    """Одна правка: что было и что станет после публикации."""

    path: str
    before: str
    after: str
    changed: bool = False
    error: Optional[str] = None


class EditPreviewOut(BaseModel):
    entity_id: int
    label: str
    rows: list[EditPreviewRow] = Field(default_factory=list)


# ---------- ход ----------
class TurnStateOut(BaseModel):
    """Состояние хода проекта для панели «Ход»."""

    turn_number: int
    # Есть ли снимок предыдущего хода, к которому можно откатиться.
    can_rollback: bool = False


class TurnPreviewOut(BaseModel):
    """Что автоизменения сделают со всеми сущностями при завершении хода."""

    turn_number: int
    entities: list[EditPreviewOut] = Field(default_factory=list)
    # Есть ли хоть одна ошибка правила — тогда «Завершить ход» откажет.
    has_errors: bool = False


class TurnEndRequest(BaseModel):
    """Завершение хода. `expected_turn` — защита от повторного клика.

    Если номер хода на сервере уже другой (ход завершил кто-то ещё), запрос
    отклоняется, а не начисляет доход второй раз.
    """

    expected_turn: int


# ---------- post (верд) ----------
class EntityEditOp(BaseModel):
    """Одна операция над атрибутом сущности.

    mode:
      set    — записать value как есть (число/строка/список/объект)
      expr   — вычислить арифметику по атрибутам, напр. "ВС.людские_ресурсы - 10"
      delete — удалить атрибут
      append — добавить value элементом в список по пути (повтор ничего не меняет)
      remove — убрать элемент, равный value, из списка по пути
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


class EditsPreviewRequest(BaseModel):
    """Правки, ещё не сохранённые в верде: считаем «было → станет» на лету."""

    edits: list[EntityEdit] = Field(default_factory=list)


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
    embed_author_name: str = ""
    embed_author_icon_url: str = ""
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
    embed_author_name: Optional[str] = None
    embed_author_icon_url: Optional[str] = None
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
    embed_author_name: str
    embed_author_icon_url: str
    embed_image_url: str
    embed_color: str


# ---------- шаблоны вердов ----------
class PostTemplateCreate(BaseModel):
    name: str
    # Имена полей верда, которые шаблон переносит, и их значения.
    fields: list[str] = Field(default_factory=list)
    data: dict[str, Any] = Field(default_factory=dict)


class PostTemplateUpdate(BaseModel):
    name: Optional[str] = None
    fields: Optional[list[str]] = None
    data: Optional[dict[str, Any]] = None


class PostTemplateOut(ORMModel):
    id: int
    project_id: int
    name: str
    fields: list[str]
    data: dict[str, Any]
    created_at: datetime


class TemplateFieldOut(BaseModel):
    """Поле верда, которое можно положить в шаблон (для галочек в интерфейсе)."""

    key: str
    label: str


# ---------- настройки канала ----------
class ChannelSettingOut(ORMModel):
    id: int
    project_id: int
    discord_channel_id: DiscordId
    auto_proxy: bool


class ChannelSettingUpdate(BaseModel):
    auto_proxy: Optional[bool] = None


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
    review_note: str = ""
    reviewed_by: str
    reviewed_at: Optional[datetime]
    created_at: datetime


class RegistrationReview(BaseModel):
    """Решение мастера по заявке.

    Сущность при одобрении НЕ создаётся: заявка — это анкета, а сущность
    заводится отдельно, со своим типом, атрибутами и описанием. Готовую можно
    указать в `entity_id` — игрок станет её участником.
    """

    # Текст, который уйдёт игроку в ЛС: причина отказа или напутствие.
    note: str = ""
    # Привязать игрока к уже существующей сущности.
    entity_id: Optional[int] = None
    # Не писать игроку (решение сообщат иначе).
    notify: bool = True


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


class ProjectBriefOut(BaseModel):
    """Проект сервера для автодополнения аргумента команды /about."""

    project_id: int
    label: str


class AboutProjectOut(BaseModel):
    """Карточка проекта для команды /about."""

    project_id: int
    label: str
    type: str
    desc: str
    authors: str
    media_url: str
    media_filename: str
    media_content_type: str


class MeInfoOut(BaseModel):
    entity_id: int
    label: str
    # Первая страница — для совместимости со старым ботом.
    rendered: str
    pages: list[str] = Field(default_factory=list)
    # Цвет каждой страницы, тем же порядком.
    colors: list[str] = Field(default_factory=list)
    picture_url: str = ""


# ---------- речь от лица сущности ----------
class ProxyEntityOut(BaseModel):
    entity_id: int
    label: str
    # Абсолютный URL картинки: аватар вебхука Discord скачивает сам, поэтому
    # внутренний путь /uploads/... ему не подходит.
    picture_url: str = ""


class ProxyContextOut(BaseModel):
    """Всё, что боту нужно знать про сообщение игрока в канале."""

    project_id: int
    auto_proxy: bool
    # Сущность, от лица которой говорить. None — выбрать не из чего либо неясно.
    entity: Optional[ProxyEntityOut] = None
    candidates: list[ProxyEntityOut] = Field(default_factory=list)
    # Кандидатов несколько, а явного выбора игрок не сделал.
    ambiguous: bool = False


class ProxyChoiceIn(BaseModel):
    guild_id: DiscordId
    discord_channel_id: DiscordId
    player_id: DiscordId
    entity_id: int


class PendingDmOut(BaseModel):
    """Неотправленное личное сообщение игроку — бот забирает опросом."""

    id: int
    project_id: int
    player_id: DiscordId
    title: str
    body: str
    color: str


class DmResultIn(BaseModel):
    """Итог отправки. Пустая ошибка — доставлено."""

    error: str = ""


class SystemInfoOut(BaseModel):
    """Что мешает картинкам доехать до Discord — проверка настроек.

    Discord скачивает аватарки и картинки эмбедов сам, поэтому внутренний путь
    `/uploads/...` ему бесполезен: без `PUBLIC_BASE_URL` загруженные файлы
    молча не подставляются. Дашборд по этим полям показывает предупреждение.
    """

    public_base_url: str = ""
    uploads_public: bool = False


class PendingPostOut(BaseModel):
    id: int
    project_id: int
    target_channel_id: Optional[DiscordId]
    content: str
    title: str
    use_embed: bool
    embed_title: str
    embed_description: str
    embed_author_name: str = ""
    embed_author_icon_url: str = ""
    embed_image_url: str
    embed_color: str
    author_name: str
    author_avatar_url: str
    attachments: list[Any] = Field(default_factory=list)
