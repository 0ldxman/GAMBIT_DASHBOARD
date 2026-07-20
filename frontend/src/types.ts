export interface Project {
  id: number;
  label: string;
  type: string;
  desc: string;
  guild_id: number | null;
  created_at: string;
}

export interface Channel {
  id: number;
  project_id: number;
  channel_id: number;
  channel_type: string;
  label: string;
}

export interface EntityType {
  id: number;
  project_id: number;
  slug: string;
  label: string;
  attributes_template: string;
}

export interface Assignment {
  id: number;
  player_id: number | null;
}

export interface Entity {
  id: number;
  project_id: number;
  type_id: number | null;
  label: string;
  picture: string;
  parent_id: number | null;
  attributes: Record<string, unknown>;
  assignment: Assignment | null;
}

export type PostStatus = "draft" | "scheduled" | "published";

export interface EntityEdit {
  entity_id: number;
  attributes: Record<string, unknown>;
}

export interface Post {
  id: number;
  project_id: number;
  channel_id: number | null;
  target_channel_id: number | null;
  title: string;
  status: PostStatus;
  content: string;
  attachments: unknown[];
  entity_edits: EntityEdit[];
  reply_to: number | null;
  scheduled_at: string | null;
  published_at: string | null;
  published_message_id: number | null;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  author_name: string;
  author_avatar_url: string;
  use_embed: boolean;
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
  discord_user_id: number;
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
  player_id: number | null;
  discord_channel_id: number | null;
  is_read: boolean;
  created_at: string;
}
