# Gambit Dashboard — backend

Инструмент **мастеров** Военно-Политической Игры (play-by-post в Discord).
Стек: FastAPI + SQLAlchemy 2.0 (async) + **Postgres** + Alembic. Авторизация — **общий пароль** мастеров.
Разворачивание — Docker/Portainer (`docker-compose.yml` в корне).

## База данных (реализовано в app/models.py)

**project** — игра
- id (PK), label, type, desc, created_at

**project_channel** — Discord-канал проекта
- id (PK), project_id (FK→project, CASCADE), channel_id (BigInt, snowflake), channel_type, label

**entity_type** — тип сущности с Jinja2-шаблоном embed
- id (PK), project_id (FK→project), slug, label, attributes_template (Text, Jinja2)

**entity** — сущность (фракция/страна/юнит/персонаж/локация)
- id (PK), project_id (FK→project), type_id (FK→entity_type, SET NULL, nullable),
  label, picture, parent_id (FK→entity, SET NULL, nullable), attributes (JSONB, свободный key-value)

**project_entity** — закрепление сущности за игроком
- id (PK), project_id, entity_id (FK→entity, unique), player_id (BigInt = Discord user id, nullable)

**project_post** — «верд» (мастерский пост-сводка)
- id (PK), project_id, channel_id (FK→project_channel, SET NULL), title,
  status (draft|scheduled|published), content, attachments (JSONB), entity_edits (JSONB),
  reply_to (FK→project_post), scheduled_at, published_at, published_message_id (BigInt),
  created_by/at, updated_by/at

## Механика
- **Правки сущностей**: entity_edits = `[{entity_id, attributes}]`. При публикации — простое обновление
  (перезапись указанных ключей entity.attributes). Без истории.
- **Шаблоны**: attributes_template рендерится Jinja2 (кириллица поддержана: `{{ ключ }}` для
  идентификаторов, `{{ attrs['ключ с пробелом'] }}` для остальных). Отсутствующие ключи → пусто.
  Эндпоинт /entities/{id}/render — для команды /me-info бота.
- **Публикация**: /posts/{id}/publish (сразу) или /schedule (scheduled_at + фоновый шедулер
  app/scheduler.py). API применяет правки и ставит published; **отправку в Discord делает бот**
  (забирает published верды без published_message_id, шлёт, проставляет id).

## API (31 endpoint)
auth (login/me), projects, projects/{}/channels, projects/{}/entity-types (+preview),
projects/{}/entities (+assignment, +render), projects/{}/posts (+publish, +schedule).
OpenAPI: /docs.

## Bot-фичи (миграция 0002)
- project.guild_id (Discord-сервер → проект для команд бота).
- project_post: +target_channel_id (любой Discord-канал), +author_name/author_avatar_url,
  +use_embed/embed_image_url/embed_color. Публикация требует target_channel_id.
- channel_webhook: кэш вебхуков (discord_channel_id → webhook_url).
- registration_form + registration (заявки) + notification (ping/registration/system, is_read).
- /internal/* (X-Internal-Key=INTERNAL_API_KEY): pending-posts, posts/{}/delivered, webhooks
  (GET/POST upsert), me-info, ping, forms/open, registrations.
- Мастерские: /projects/{}/forms, /registrations (approve/reject), /notifications.

## Discord-бот (bot/, discord.py 2.4)
- deliver_posts loop: /internal/pending-posts → вебхук в target_channel_id (создаёт/кэш) →
  send(content + опц. embed, username/avatar=автор) → mark_delivered.
- Слэш: /me-info, /ping-master, /register (модалка из формы, макс 5 полей).
- env: DISCORD_BOT_TOKEN, API_BASE, INTERNAL_API_KEY, BOT_POLL_SECONDS.

## Фронтенд (React+Vite+TS, frontend/)
- Login → токен. Дашборд (+guild_id при создании).
- Экран проекта, вкладки: Верды (автор/эмбед/канал/правки/publish/schedule), Сущности, Типы
  (шаблон+предпросмотр), Каналы, Формы (конструктор полей), Заявки (approve/reject +создать
  сущность), Уведомления (бейдж непрочитанных, опрос 20с).
- Экран сущности: атрибуты + игрок + живой предпросмотр embed.
- Prod: nginx (frontend/Dockerfile+nginx.conf) отдаёт SPA + /api → backend:8000.

## Развёртывание
- docker-compose.yml (сборка) — db+backend+bot+frontend. docker-compose.portainer.yml — образы
  ghcr.io/${IMAGE_OWNER}/gambit-{backend,bot,frontend}. .github/workflows/docker.yml — matrix в GHCR.
- README.md — инструкции. .env.example (корень) — все переменные.

## Не проверено
- Бот вживую (нужен токен + сервер Discord) — код и py_compile OK.
- Прогон на живом Postgres (локально недоступен) — offline SQL и цепочка миграций OK.
