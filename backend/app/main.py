import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.routers import auth
from app.routers import channels
from app.routers import discord
from app.routers import entities
from app.routers import entity_types
from app.routers import forms
from app.routers import internal
from app.routers import notifications
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
app.include_router(projects.router)
app.include_router(channels.router)
app.include_router(discord.router)
app.include_router(entity_types.router)
app.include_router(entities.router)
app.include_router(posts.router)
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
