import type {
  AppNotification,
  Channel,
  Entity,
  EntityType,
  Post,
  Project,
  Registration,
  RegistrationForm,
  TemplatePreview,
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

  // projects
  listProjects: () => request<Project[]>("GET", "/projects"),
  getProject: (id: number) => request<Project>("GET", `/projects/${id}`),
  createProject: (data: Partial<Project>) =>
    request<Project>("POST", "/projects", data),
  updateProject: (id: number, data: Partial<Project>) =>
    request<Project>("PATCH", `/projects/${id}`, data),
  deleteProject: (id: number) => request<void>("DELETE", `/projects/${id}`),

  // channels
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
  previewTemplate: (
    pid: number,
    data: { template: string; attributes: Record<string, unknown>; label: string },
  ) =>
    request<TemplatePreview>("POST", `/projects/${pid}/entity-types/preview`, data),

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
  assignPlayer: (pid: number, eid: number, player_id: number | null) =>
    request<Entity>("PUT", `/projects/${pid}/entities/${eid}/assignment`, {
      player_id,
    }),
  renderEntity: (pid: number, eid: number) =>
    request<TemplatePreview>("GET", `/projects/${pid}/entities/${eid}/render`),

  // posts (верды)
  listPosts: (pid: number, status?: string) =>
    request<Post[]>(
      "GET",
      `/projects/${pid}/posts${status ? `?status=${status}` : ""}`,
    ),
  createPost: (pid: number, data: Partial<Post>) =>
    request<Post>("POST", `/projects/${pid}/posts`, data),
  updatePost: (pid: number, postId: number, data: Partial<Post>) =>
    request<Post>("PATCH", `/projects/${pid}/posts/${postId}`, data),
  deletePost: (pid: number, postId: number) =>
    request<void>("DELETE", `/projects/${pid}/posts/${postId}`),
  publishPost: (pid: number, postId: number) =>
    request<Post>("POST", `/projects/${pid}/posts/${postId}/publish`),
  schedulePost: (pid: number, postId: number, scheduledAt: string) =>
    request<Post>(
      "POST",
      `/projects/${pid}/posts/${postId}/schedule?scheduled_at=${encodeURIComponent(scheduledAt)}`,
    ),

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
  markNotificationRead: (pid: number, nid: number) =>
    request<AppNotification>("POST", `/projects/${pid}/notifications/${nid}/read`),
  markAllNotificationsRead: (pid: number) =>
    request<{ status: string }>("POST", `/projects/${pid}/notifications/read-all`),
};
