import os


class Config:
    # Токен Discord-бота.
    discord_token: str = os.environ.get("DISCORD_BOT_TOKEN", "")
    # Базовый URL backend API (в докере — http://backend:8000).
    api_base: str = os.environ.get("API_BASE", "http://localhost:8000")
    # Общий секрет для /internal/* (должен совпадать с backend INTERNAL_API_KEY).
    internal_api_key: str = os.environ.get("INTERNAL_API_KEY", "dev-internal-key-change-me")
    # Как часто опрашивать backend на предмет вердов к отправке (сек).
    poll_seconds: int = int(os.environ.get("BOT_POLL_SECONDS", "15"))
    # Читать текст сообщений. Нужен авто-подмене, но это privileged intent:
    # без галочки в Developer Portal Discord не пустит бота вообще. Поставьте 0,
    # если авто-подмена не нужна.
    message_content: bool = os.environ.get("BOT_MESSAGE_CONTENT", "1") not in ("0", "false", "")


config = Config()
