import type {
  AccessLevel,
  AppNotification,
  Attachment,
  Channel,
  ChannelTree,
  ComputedField,
  DiscordChannel,
  DiscordGuild,
  DiscordMember,
  DiscordRole,
  EditPreview,
  Entity,
  EntityChannel,
  EntityEdit,
  EntityLink,
  EntityPingCount,
  EntityType,
  GuildPlayer,
  Member,
  Relation,
  Post,
  PostTemplate,
  Project,
  ProjectRole,
  ProjectStats,
  Registration,
  RegistrationForm,
  TemplateField,
  TemplatePages,
} from "./types";

const TOKEN_KEY = "gambit_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    clearToken();
    throw new ApiError(401, "Требуется авторизация");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // auth
  login: (password: string) =>
    request<{ access_token: string }>("POST", "/auth/login", { password }),

  // серверы, где стоит бот
  listGuilds: () => request<DiscordGuild[]>("GET", "/guilds"),
  listGuildChannels: (guildId: string) =>
    request<DiscordChannel[]>("GET", `/guilds/${guildId}/channels`),
  listGuildRoles: (guildId: string) =>
    request<DiscordRole[]>("GET", `/guilds/${guildId}/roles`),

  // projects
  listProjects: (guildId?: string) =>
    request<Project[]>(
      "GET",
      `/projects${guildId ? `?guild_id=${guildId}` : ""}`,
    ),
  getProject: (id: number) => request<Project>("GET", `/projects/${id}`),
  createProject: (data: Partial<Project> & { category_ids?: string[] }) =>
    request<Project>("POST", "/projects", data),
  updateProject: (id: number, data: Partial<Project> & { category_ids?: string[] }) =>
    request<Project>("PATCH", `/projects/${id}`, data),
  deleteProject: (id: number) => request<void>("DELETE", `/projects/${id}`),

  // категории проекта (discord id строками)
  projectStats: (guildId?: string) =>
    request<ProjectStats[]>(
      "GET",
      `/projects/stats${guildId ? `?guild_id=${guildId}` : ""}`,
    ),
  listCategories: (pid: number) =>
    request<string[]>("GET", `/projects/${pid}/categories`),

  // роли проекта с уровнем доступа
  listProjectRoles: (pid: number) =>
    request<ProjectRole[]>("GET", `/projects/${pid}/roles`),
  addProjectRole: (
    pid: number,
    data: { role_id: string; name: string; access_level: AccessLevel },
  ) => request<ProjectRole>("POST", `/projects/${pid}/roles`, data),
  updateProjectRole: (pid: number, rid: number, data: { access_level: AccessLevel }) =>
    request<ProjectRole>("PATCH", `/projects/${pid}/roles/${rid}`, data),
  deleteProjectRole: (pid: number, rid: number) =>
    request<void>("DELETE", `/projects/${pid}/roles/${rid}`),

  // channels
  channelTree: (pid: number) =>
    request<ChannelTree>("GET", `/projects/${pid}/channels/tree`),
  // Единый список каналов проекта — и для экрана каналов, и для доступа сущности.
  availableChannels: (pid: number) =>
    request<DiscordChannel[]>("GET", `/projects/${pid}/channels/available`),
  grantEntityChannel: (pid: number, discordChannelId: string, entityId: number) =>
    request<EntityLink>(
      "POST",
      `/projects/${pid}/channels/${discordChannelId}/entities/${entityId}`,
    ),
  revokeEntityChannel: (pid: number, discordChannelId: string, entityId: number) =>
    request<void>(
      "DELETE",
      `/projects/${pid}/channels/${discordChannelId}/entities/${entityId}`,
    ),
  listChannels: (pid: number) =>
    request<Channel[]>("GET", `/projects/${pid}/channels`),
  createChannel: (pid: number, data: Partial<Channel>) =>
    request<Channel>("POST", `/projects/${pid}/channels`, data),
  updateChannel: (pid: number, cid: number, data: Partial<Channel>) =>
    request<Channel>("PATCH", `/projects/${pid}/channels/${cid}`, data),
  deleteChannel: (pid: number, cid: number) =>
    request<void>("DELETE", `/projects/${pid}/channels/${cid}`),

  // entity types
  listTypes: (pid: number) =>
    request<EntityType[]>("GET", `/projects/${pid}/entity-types`),
  createType: (pid: number, data: Partial<EntityType>) =>
    request<EntityType>("POST", `/projects/${pid}/entity-types`, data),
  updateType: (pid: number, tid: number, data: Partial<EntityType>) =>
    request<EntityType>("PATCH", `/projects/${pid}/entity-types/${tid}`, data),
  deleteType: (pid: number, tid: number) =>
    request<void>("DELETE", `/projects/${pid}/entity-types/${tid}`),
  // Предпросмотр всех страниц сразу — с длиной каждой готовой страницы.
  previewPages: (
    pid: number,
    data: {
      pages: string[];
      attributes: Record<string, unknown>;
      label: string;
      /** Формулы типа. */
      computed?: ComputedField[];
      /** Свои формулы сущности — сервер сольёт их с типовыми. */
      computed_own?: ComputedField[];
    },
  ) =>
    request<TemplatePages>("POST", `/projects/${pid}/entity-types/preview-pages`, data),

  // entities
  listEntities: (pid: number) =>
    request<Entity[]>("GET", `/projects/${pid}/entities`),
  getEntity: (pid: number, eid: number) =>
    request<Entity>("GET", `/projects/${pid}/entities/${eid}`),
  createEntity: (pid: number, data: Partial<Entity>) =>
    request<Entity>("POST", `/projects/${pid}/entities`, data),
  updateEntity: (pid: number, eid: number, data: Partial<Entity>) =>
    request<Entity>("PATCH", `/projects/${pid}/entities/${eid}`, data),
  deleteEntity: (pid: number, eid: number) =>
    request<void>("DELETE", `/projects/${pid}/entities/${eid}`),
  renderEntity: (pid: number, eid: number) =>
    request<TemplatePages>("GET", `/projects/${pid}/entities/${eid}/render`),

  // участники сущности (несколько игроков с ролями)
  listMembers: (pid: number, eid: number) =>
    request<Member[]>("GET", `/projects/${pid}/entities/${eid}/members`),
  addMember: (
    pid: number,
    eid: number,
    data: { player_id: string; role: string; is_primary: boolean },
  ) => request<Member>("POST", `/projects/${pid}/entities/${eid}/members`, data),
  updateMember: (
    pid: number,
    eid: number,
    mid: number,
    data: { role?: string; is_primary?: boolean },
  ) => request<Member>("PATCH", `/projects/${pid}/entities/${eid}/members/${mid}`, data),
  removeMember: (pid: number, eid: number, mid: number) =>
    request<void>("DELETE", `/projects/${pid}/entities/${eid}/members/${mid}`),

  // типизированные связи сущностей
  listRelations: (pid: number, eid: number) =>
    request<Relation[]>("GET", `/projects/${pid}/entities/${eid}/relations`),
  addRelation: (
    pid: number,
    eid: number,
    data: { child_id: number; relation_type: string },
  ) => request<Relation>("POST", `/projects/${pid}/entities/${eid}/relations`, data),
  deleteRelation: (pid: number, eid: number, rid: number) =>
    request<void>("DELETE", `/projects/${pid}/entities/${eid}/relations/${rid}`),

  // каналы сущности
  listEntityChannels: (pid: number, eid: number) =>
    request<EntityChannel[]>("GET", `/projects/${pid}/entities/${eid}/channels`),
  linkEntityChannel: (
    pid: number,
    eid: number,
    data: { discord_channel_id: string; label: string; sync_access: boolean },
  ) => request<EntityChannel>("POST", `/projects/${pid}/entities/${eid}/channels`, data),
  updateEntityChannel: (
    pid: number,
    eid: number,
    lid: number,
    data: { label?: string; sync_access?: boolean },
  ) => request<EntityChannel>("PATCH", `/projects/${pid}/entities/${eid}/channels/${lid}`, data),
  unlinkEntityChannel: (pid: number, eid: number, lid: number) =>
    request<void>("DELETE", `/projects/${pid}/entities/${eid}/channels/${lid}`),

  // posts (верды)
  listPosts: (pid: number, status?: string) =>
    request<Post[]>(
      "GET",
      `/projects/${pid}/posts${status ? `?status=${status}` : ""}`,
    ),
  getPost: (pid: number, postId: number) =>
    request<Post>("GET", `/projects/${pid}/posts/${postId}`),
  createPost: (pid: number, data: Partial<Post>) =>
    request<Post>("POST", `/projects/${pid}/posts`, data),
  updatePost: (pid: number, postId: number, data: Partial<Post>) =>
    request<Post>("PATCH", `/projects/${pid}/posts/${postId}`, data),
  deletePost: (pid: number, postId: number) =>
    request<void>("DELETE", `/projects/${pid}/posts/${postId}`),
  // Что правки сделают с сущностями — до необратимой публикации.
  previewEdits: (pid: number, edits: EntityEdit[]) =>
    request<EditPreview[]>("POST", `/projects/${pid}/posts/preview-edits`, { edits }),
  publishPost: (pid: number, postId: number) =>
    request<Post>("POST", `/projects/${pid}/posts/${postId}/publish`),
  schedulePost: (pid: number, postId: number, scheduledAt: string) =>
    request<Post>(
      "POST",
      `/projects/${pid}/posts/${postId}/schedule?scheduled_at=${encodeURIComponent(scheduledAt)}`,
    ),

  // шаблоны вердов
  templateFields: (pid: number) =>
    request<TemplateField[]>("GET", `/projects/${pid}/post-templates/fields`),
  listPostTemplates: (pid: number) =>
    request<PostTemplate[]>("GET", `/projects/${pid}/post-templates`),
  createPostTemplate: (
    pid: number,
    data: { name: string; fields: string[]; data: Record<string, unknown> },
  ) => request<PostTemplate>("POST", `/projects/${pid}/post-templates`, data),
  deletePostTemplate: (pid: number, tid: number) =>
    request<void>("DELETE", `/projects/${pid}/post-templates/${tid}`),

  // настройки канала (авто-подмена от лица сущности)
  updateChannelSettings: (pid: number, channelId: string, data: { auto_proxy: boolean }) =>
    request<{ discord_channel_id: string; auto_proxy: boolean }>(
      "PATCH",
      `/projects/${pid}/channels/settings/${channelId}`,
      data,
    ),

  // вложения (multipart, поэтому мимо общего request())
  uploadAttachment: async (pid: number, file: File): Promise<Attachment> => {
    const form = new FormData();
    form.append("file", file);
    const token = getToken();
    const res = await fetch(`/api/projects/${pid}/uploads`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const data = await res.json();
        detail = typeof data.detail === "string" ? data.detail : detail;
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, detail);
    }
    return (await res.json()) as Attachment;
  },

  // discord справочники
  listDiscordChannels: (pid: number) =>
    request<DiscordChannel[]>("GET", `/projects/${pid}/discord/channels`),
  getDiscordMember: (pid: number, userId: string) =>
    request<DiscordMember>("GET", `/projects/${pid}/discord/members/${userId}`),
  listGuildPlayers: (pid: number) =>
    request<GuildPlayer[]>("GET", `/projects/${pid}/discord/players`),
  listDiscordRoles: (pid: number) =>
    request<DiscordRole[]>("GET", `/projects/${pid}/discord/roles`),
  createDiscordChannel: (
    pid: number,
    data: {
      name: string;
      channel_type: string;
      parent_id: string | null;
      private: boolean;
      entity_id: number | null;
      register_channel: boolean;
    },
  ) => request<DiscordChannel>("POST", `/projects/${pid}/discord/channels`, data),
  // Необратимо: удаляет канал на сервере вместе с историей.
  deleteDiscordChannel: (pid: number, channelId: string) =>
    request<void>("DELETE", `/projects/${pid}/discord/channels/${channelId}`),

  // forms (регистрационные формы)
  listForms: (pid: number) =>
    request<RegistrationForm[]>("GET", `/projects/${pid}/forms`),
  createForm: (pid: number, data: Partial<RegistrationForm>) =>
    request<RegistrationForm>("POST", `/projects/${pid}/forms`, data),
  updateForm: (pid: number, fid: number, data: Partial<RegistrationForm>) =>
    request<RegistrationForm>("PATCH", `/projects/${pid}/forms/${fid}`, data),
  deleteForm: (pid: number, fid: number) =>
    request<void>("DELETE", `/projects/${pid}/forms/${fid}`),

  // registrations (заявки)
  listRegistrations: (pid: number, status?: string) =>
    request<Registration[]>(
      "GET",
      `/projects/${pid}/registrations${status ? `?status=${status}` : ""}`,
    ),
  approveRegistration: (
    pid: number,
    rid: number,
    data: { create_entity: boolean; entity_label: string; entity_type_id: number | null },
  ) => request<Registration>("POST", `/projects/${pid}/registrations/${rid}/approve`, data),
  rejectRegistration: (pid: number, rid: number) =>
    request<Registration>("POST", `/projects/${pid}/registrations/${rid}/reject`),

  // notifications
  listNotifications: (pid: number, unreadOnly = false) =>
    request<AppNotification[]>(
      "GET",
      `/projects/${pid}/notifications${unreadOnly ? "?unread_only=true" : ""}`,
    ),
  entityPingCounts: (pid: number) =>
    request<EntityPingCount[]>("GET", `/projects/${pid}/notifications/entity-counts`),
  markNotificationRead: (pid: number, nid: number) =>
    request<AppNotification>("POST", `/projects/${pid}/notifications/${nid}/read`),
  markAllNotificationsRead: (pid: number) =>
    request<{ status: string }>("POST", `/projects/${pid}/notifications/read-all`),
};
