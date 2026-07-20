# Gambit Dashboard

Инструмент **мастеров** Военно-Политической Игры (play-by-post в Discord): управление проектами,
сущностями, вердами (посты-сводки), регистрацией игроков и уведомлениями.

## Состав

| Компонент | Стек | Каталог |
|---|---|---|
| Backend API | FastAPI + SQLAlchemy 2 (async) + Postgres + Alembic | `backend/` |
| Discord-бот | discord.py (вебхуки + слэш-команды) | `bot/` |
| Frontend | React + Vite + TS (nginx в проде) | `frontend/` |

## Возможности

- **Проекты** и привязка Discord-каналов. `guild_id` проекта = Discord-сервер (по нему бот
  определяет проект для команд).
- **Сущности** с типами и **Jinja2-шаблонами embed** (кириллица), иерархия, закрепление за игроком
  (Discord user id).
- **Верды**: черновик → публикация/расписание. Публикация применяет правки атрибутов сущностей.
  Бот отправляет верд **через вебхук** в любой канал (создаёт вебхук при необходимости), с подменой
  имени/аватара автора и опциональным эмбедом.
- **Слэш-команды бота**: `/me-info` (карточка сущности), `/ping-master` (уведомление мастеру),
  `/register` (форма регистрации в виде модалки).
- **Регистрационные формы**: мастер конструирует поля; заявки игроков рассматриваются в дашборде
  (одобрить с созданием сущности / отклонить).
- **Уведомления**: пинги игроков и новые заявки прилетают во вкладку «Уведомления».

## Локальный запуск (Docker)

```bash
cp .env.example .env      # заполните пароли, DISCORD_BOT_TOKEN, INTERNAL_API_KEY
docker compose up --build
```

- Дашборд: http://localhost:8080 (nginx проксирует `/api` на backend)
- API/Swagger: http://localhost:8000/docs

Миграции применяются автоматически при старте backend-контейнера.

## Разработка (без Docker)

```bash
# Backend (нужен запущенный Postgres, DATABASE_URL в окружении)
cd backend && pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload

# Frontend
cd frontend && npm install && npm run dev   # http://localhost:5173, /api → :8000
```

## Развёртывание в Portainer (готовые образы из GHCR)

1. Запушьте репозиторий в GitHub. Workflow `.github/workflows/docker.yml` соберёт и опубликует
   образы `ghcr.io/<owner>/gambit-backend|bot|frontend` при пуше в `main` (или теге `v*`).
2. Убедитесь, что пакеты GHCR доступны (при необходимости сделайте их публичными или добавьте
   registry-креды в Portainer).
3. В Portainer → **Stacks → Add stack** вставьте `docker-compose.portainer.yml`, задайте переменные
   окружения из `.env.example` (обязательно `IMAGE_OWNER`, пароли, `INTERNAL_API_KEY`,
   `DISCORD_BOT_TOKEN`).
4. Deploy. Дашборд — на `FRONTEND_PORT` (по умолчанию 8080).

## Discord-бот: настройка

1. В [Developer Portal](https://discord.com/developers/applications) создайте приложение и бота,
   скопируйте **токен** в `DISCORD_BOT_TOKEN`.
2. Права бота: `Manage Webhooks`, `Send Messages`, а также `applications.commands` (слэш-команды).
3. Пригласите бота на сервер, укажите `guild_id` этого сервера в настройках проекта.
4. `INTERNAL_API_KEY` бота и backend **должны совпадать**.

## Безопасность

- Вход мастеров — по общему паролю (`MASTER_PASSWORD`), токен подписывается `SECRET_KEY`.
- Ручки `/internal/*` (для бота) защищены `INTERNAL_API_KEY`.
- Перед продом смените все значения из `.env.example` на случайные секреты.
# GAMBIT_DASHBOARD
