export interface Project {
  id: number;
  label: string;
  type: string;
  desc: string;
  /** Авторы проекта — выводятся в карточке /about. */
  authors: string;
  guild_id: string | null;
  /** Одно вложение внутрь эмбеда /about. */
  media_url: string;
  media_filename: string;
  media_content_type: string;
  created_at: string;
}

/** Уровень доступа роли внутри проекта. */
export type AccessLevel = "admin" | "moderator" | "player";

export interface ProjectRole {
  id: number;
  project_id: number;
  role_id: string;
  name: string;
  access_level: AccessLevel;
}

/** Сервер Discord, на котором стоит бот. */
export interface DiscordGuild {
  guild_id: string;
  name: string;
  icon_url: string | null;
  member_count: number | null;
  project_count: number;
}

/** Сводка по проекту для карточки на экране сервера. */
export interface ProjectStats {
  project_id: number;
  entity_count: number;
  player_count: number;
}

export interface Channel {
  id: number;
  project_id: number;
  channel_id: string;
  channel_type: string;
  label: string;
  discord_parent_id: string | null;
}

export interface EntityType {
  id: number;
  project_id: number;
  slug: string;
  label: string;
  /** Зеркало первой страницы — оставлено для типов, созданных до страниц. */
  attributes_template: string;
  /** Страницы описания: каждая уходит в Discord отдельным эмбедом. */
  description_pages: string[];
  /** Заготовка атрибутов: с неё создаётся новая сущность типа. */
  attributes_schema: Record<string, unknown>;
  /** Формулы от атрибутов: в шаблоне доступны как {{ выч.путь }}. */
  computed: ComputedField[];
}

/** Вычисляемое поле типа: путь в дереве формул, подпись и выражение. */
export interface ComputedField {
  path: string;
  label: string;
  expr: string;
}

/** Откуда формула: от типа, своя у сущности или своя вместо типовой. */
export type ComputedSource = "type" | "entity" | "override" | "";

/** Значение формулы на конкретных атрибутах. */
export interface ComputedValue {
  path: string;
  label: string;
  /** Готовый текст («12 400»); при ошибке пустой. */
  text: string;
  error: string | null;
  source: ComputedSource;
}

export interface Member {
  id: number;
  entity_id: number;
  player_id: string;
  role: string;
  is_primary: boolean;
  player_name: string;
  player_avatar_url: string;
}

/** Типизированная связь сущностей: parent → child. */
export interface Relation {
  id: number;
  parent_id: number;
  child_id: number;
  relation_type: string;
}

/** Привязка Discord-канала к сущности. */
export interface EntityChannel {
  id: number;
  entity_id: number;
  discord_channel_id: string;
  label: string;
  sync_access: boolean;
}

export interface DiscordRole {
  role_id: string;
  name: string;
  position: number;
}

/** Канал сервера Discord (справочник для выбора). */
export interface DiscordChannel {
  channel_id: string;
  name: string;
  type: string;
  position: number;
  parent_id: string | null;
  parent_name: string | null;
}

/** Дерево каналов проекта: категории и собранные внутри них каналы. */
export interface EntityLink {
  link_id: number;
  entity_id: number;
  entity_label: string;
  sync_access: boolean;
}

export interface ChannelNode {
  channel_id: string;
  name: string;
  type: string;
  position: number;
  registered_id: number | null;
  entities: EntityLink[];
  /** Сообщения игроков подменяются вебхуком от лица их сущности. */
  auto_proxy: boolean;
}

export interface CategoryNode {
  id: number;
  channel_id: string;
  name: string;
  missing: boolean;
  channels: ChannelNode[];
}

export interface ChannelTree {
  categories: CategoryNode[];
  loose: ChannelNode[];
  error: string | null;
}

/** Непрочитанные пинги игроков по сущности. */
export interface EntityPingCount {
  entity_id: number;
  unread: number;
}

/** Профиль участника сервера Discord. */
export interface DiscordMember {
  player_id: string;
  name: string;
  avatar_url: string;
}

/** Участник сервера с ролями проекта — для выбора игрока из списка. */
export interface GuildPlayer extends DiscordMember {
  role_names: string[];
}

export interface Entity {
  id: number;
  project_id: number;
  type_id: number | null;
  label: string;
  picture: string;
  attributes: Record<string, unknown>;
  /** Особое описание замещает страницы типа. */
  use_custom_description: boolean;
  description_pages: string[];
  /** Свои формулы: дополняют формулы типа, совпадение путей — переопределяет. */
  computed: ComputedField[];
  members: Member[];
}

export type PostStatus = "draft" | "scheduled" | "published";

/** Режим операции: записать / вычислить / удалить / добавить в список / убрать из него. */
export type EditMode = "set" | "expr" | "delete" | "append" | "remove";

export interface EntityEditOp {
  path: string;
  mode: EditMode;
  value: unknown;
}

export interface EntityEdit {
  entity_id: number;
  ops: EntityEditOp[];
  attributes?: Record<string, unknown>;
}

/** Одна строка предпросмотра правки: что было и что станет. */
export interface EditPreviewRow {
  path: string;
  before: string;
  after: string;
  changed: boolean;
  error: string | null;
}

export interface EditPreview {
  entity_id: number;
  label: string;
  rows: EditPreviewRow[];
}

export interface Attachment {
  url: string;
  filename: string;
  size: number;
  content_type: string;
}

export interface Post {
  id: number;
  project_id: number;
  channel_id: number | null;
  target_channel_id: string | null;
  title: string;
  status: PostStatus;
  content: string;
  attachments: Attachment[];
  entity_edits: EntityEdit[];
  reply_to: number | null;
  scheduled_at: string | null;
  published_at: string | null;
  published_message_id: string | null;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  author_name: string;
  author_avatar_url: string;
  use_embed: boolean;
  embed_title: string;
  embed_description: string;
  embed_author_name: string;
  embed_author_icon_url: string;
  embed_image_url: string;
  embed_color: string;
}

/** Одна страница описания после подстановки атрибутов. */
export interface RenderedPage {
  rendered: string;
  length: number;
  over_limit: boolean;
}

export interface TemplatePages {
  pages: RenderedPage[];
  limit: number;
  error: string | null;
  computed: ComputedValue[];
}

/** Шаблон верда: заранее отобранный набор полей. */
export interface PostTemplate {
  id: number;
  project_id: number;
  name: string;
  fields: string[];
  data: Record<string, unknown>;
  created_at: string;
}

export interface TemplateField {
  key: string;
  label: string;
}

export type FieldType = "text" | "paragraph" | "number" | "select";

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
}

export interface RegistrationForm {
  id: number;
  project_id: number;
  title: string;
  description: string;
  is_open: boolean;
  fields: FormField[];
  created_at: string;
}

export type RegistrationStatus = "pending" | "approved" | "rejected";

export interface Registration {
  id: number;
  form_id: number;
  project_id: number;
  discord_user_id: string;
  discord_username: string;
  answers: Record<string, unknown>;
  status: RegistrationStatus;
  entity_id: number | null;
  reviewed_by: string;
  reviewed_at: string | null;
  created_at: string;
}

export type NotificationType = "ping" | "registration" | "system";

export interface AppNotification {
  id: number;
  project_id: number;
  type: NotificationType;
  message: string;
  entity_id: number | null;
  player_id: string | null;
  discord_channel_id: string | null;
  is_read: boolean;
  created_at: string;
}
