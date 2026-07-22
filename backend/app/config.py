from functools import lru_cache

from pydantic_settings import BaseSettings
from pydantic_settings import SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Postgres. В докере host = имя сервиса (напр. "db").
    database_url: str = "postgresql+asyncpg://gambit:gambit@localhost:5432/gambit"

    # Общий пароль мастеров и ключ для подписи сессионных токенов.
    master_password: str = "changeme"
    secret_key: str = "dev-secret-change-me"
    session_ttl_seconds: int = 60 * 60 * 24 * 14  # 2 недели

    # CORS: адрес(а) фронтенда.
    cors_origins: list[str] = ["http://localhost:5173"]

    # Discord (используется ботом; API хранит токен для справки/webhook).
    discord_bot_token: str = ""

    # Общий секрет между API и ботом для /internal/* ручек.
    internal_api_key: str = "dev-internal-key-change-me"

    # Каталог для загруженных вложений. В докере переопределяется на том (/data/uploads).
    upload_dir: str = "./data/uploads"

    # Префикс, по которому вложения доступны из интернета. В стандартной сборке
    # nginx проксирует /api/ на backend, поэтому это "https://ваш-домен/api"
    # (файл /uploads/1/x.png → https://ваш-домен/api/uploads/1/x.png).
    # Нужен там, где файл скачивает сам Discord: аватарку вебхука он тянет по URL,
    # и внутренний путь /uploads/... ему недоступен. Пусто — такие картинки
    # просто не подставляются (сообщение уйдёт с аватаркой по умолчанию).
    public_base_url: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
