import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.routers.internal import public_base
from app.schemas import SystemInfoOut
from app.security import require_master
from app.routers import auth
from app.routers import channels
from app.routers import discord
from app.routers import entities
from app.routers import entity_types
from app.routers import forms
from app.routers import guilds
from app.routers import internal
from app.routers import notifications
from app.routers import post_templates
from app.routers import posts
from app.routers import projects
from app.routers import registrations
from app.routers import uploads
from app.scheduler import run_scheduler

logging.basicConfig(level=logging.INFO)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(run_scheduler())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="Gambit Dashboard API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(guilds.router)
app.include_router(projects.router)
app.include_router(channels.router)
app.include_router(discord.router)
app.include_router(entity_types.router)
app.include_router(entities.router)
app.include_router(posts.router)
app.include_router(post_templates.router)
app.include_router(forms.router)
app.include_router(registrations.router)
app.include_router(notifications.router)
app.include_router(uploads.router)
app.include_router(internal.router)

# Раздача загруженных вложений. Каталог создаём заранее, иначе StaticFiles упадёт.
_upload_root = Path(settings.upload_dir)
try:
    _upload_root.mkdir(parents=True, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=_upload_root), name="uploads")
except OSError:
    # Не смертельно: приложение поднимется, но загрузка вложений будет недоступна.
    logging.getLogger(__name__).warning(
        "Каталог вложений %s недоступен — раздача /uploads отключена", _upload_root
    )


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get(
    "/system/info",
    tags=["meta"],
    response_model=SystemInfoOut,
    dependencies=[Depends(require_master)],
)
async def system_info() -> SystemInfoOut:
    """Настройки, от которых зависит, доедут ли картинки до Discord.

    Дашборд по этому ответу предупреждает мастера: без PUBLIC_BASE_URL
    загруженный файл останется внутренним путём, и Discord подставит аватарку
    по умолчанию — молча, без единой ошибки.
    """
    base = public_base()
    return SystemInfoOut(public_base_url=base, uploads_public=bool(base))


@app.get("/health/config", tags=["meta"])
async def health_config() -> dict[str, object]:
    """Что backend видит в окружении. Значений секретов НЕ возвращает —
    только факт наличия и длину, чтобы ловить пустые/обрезанные переменные."""

    def probe(value: str, default: str = "") -> dict[str, object]:
        return {
            "set": bool(value) and value != default,
            "length": len(value or ""),
            # Пробелы/переводы строк по краям — частая причина «токен не работает».
            "has_surrounding_whitespace": value != value.strip() if value else False,
        }

    return {
        "discord_bot_token": probe(settings.discord_bot_token),
        "internal_api_key": probe(settings.internal_api_key, "dev-internal-key-change-me"),
        "master_password": probe(settings.master_password, "changeme"),
        "secret_key": probe(settings.secret_key, "dev-secret-change-me"),
        "upload_dir": settings.upload_dir,
        "cors_origins": settings.cors_origins,
        # Хост БД без пароля — чтобы видеть, к какому серверу подключились.
        "database_host": settings.database_url.rsplit("@", 1)[-1],
    }
