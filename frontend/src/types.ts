export interface Project {
  id: number;
  label: string;
  type: string;
  desc: string;
  guild_id: string | null;
  master_role_id: string | null;
  player_role_id: string | null;
  created_at: string;
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
  attributes_template: string;
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

/** Профиль участника сервера Discord. */
export interface DiscordMember {
  player_id: string;
  name: string;
  avatar_url: string;
}

export interface Entity {
  id: number;
  project_id: number;
  type_id: number | null;
  label: string;
  picture: string;
  attributes: Record<string, unknown>;
  members: Member[];
}

export type PostStatus = "draft" | "scheduled" | "published";

/** Режим операции над атрибутом: записать / вычислить / удалить. */
export type EditMode = "set" | "expr" | "delete";

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
  embed_image_url: string;
  embed_color: string;
}

export interface TemplatePreview {
  rendered: string;
  error: string | null;
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
