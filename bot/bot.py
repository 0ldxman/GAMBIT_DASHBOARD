"""Gambit Dashboard — Discord-бот.

Обязанности:
  1. Доставка вердов: опрашивает backend, отправляет опубликованные верды через
     вебхук (создаёт/переиспользует), с подменой имени/аватара автора и опц. эмбедом.
  2. Слэш-команды: /me-info, /ping-master, /register (модалка из формы проекта).
"""

import io
import logging
from typing import Any
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands
from discord.ext import tasks

from api import ApiClient
from config import config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bot")

intents = discord.Intents.default()
bot = commands.Bot(command_prefix="!", intents=intents)
api = ApiClient()


def _parse_color(value: str) -> Optional[discord.Color]:
    value = (value or "").strip().lstrip("#")
    if not value:
        return None
    try:
        return discord.Color(int(value, 16))
    except ValueError:
        return None


def _build_embed(post: dict[str, Any]) -> Optional[discord.Embed]:
    if not post.get("use_embed"):
        return None
    # У эмбеда собственные заголовок и описание — они отделены от текста сообщения.
    embed = discord.Embed(
        title=post.get("embed_title") or None,
        description=post.get("embed_description") or None,
        color=_parse_color(post.get("embed_color", "")),
    )
    if post.get("author_name"):
        embed.set_author(
            name=post["author_name"], icon_url=post.get("author_avatar_url") or None
        )
    if post.get("embed_image_url"):
        embed.set_image(url=post["embed_image_url"])
    return embed


async def _build_files(post: dict[str, Any]) -> list[discord.File]:
    """Скачать вложения верда с backend и превратить в discord.File."""
    files: list[discord.File] = []
    for att in post.get("attachments") or []:
        if not isinstance(att, dict) or not att.get("url"):
            continue
        try:
            data = await api.fetch_attachment(att["url"])
        except Exception:  # noqa: BLE001 — одно битое вложение не должно рушить верд
            logger.exception("Не удалось скачать вложение %s", att.get("url"))
            continue
        files.append(discord.File(io.BytesIO(data), filename=att.get("filename") or "file"))
    return files


async def _ensure_webhook(channel: discord.TextChannel, project_id: Optional[int]) -> discord.Webhook:
    """Взять вебхук канала из кэша backend или создать новый и закэшировать."""
    cached = await api.get_webhook(channel.id)
    if cached:
        return discord.Webhook.from_url(cached["webhook_url"], client=bot)
    webhook = await channel.create_webhook(name="Gambit Dashboard")
    await api.save_webhook(channel.id, webhook.id, webhook.token or "", webhook.url, project_id)
    return webhook


@tasks.loop(seconds=config.poll_seconds)
async def deliver_posts() -> None:
    try:
        posts = await api.pending_posts()
    except Exception:  # noqa: BLE001
        logger.exception("Не удалось получить список вердов")
        return

    for post in posts:
        channel_id = post.get("target_channel_id")
        if not channel_id:
            continue
        channel = bot.get_channel(int(channel_id))
        if channel is None:
            try:
                channel = await bot.fetch_channel(int(channel_id))
            except discord.DiscordException:
                logger.warning("Канал %s недоступен для верда %s", channel_id, post["id"])
                continue
        if not isinstance(channel, discord.TextChannel):
            logger.warning("Канал %s не текстовый — пропуск", channel_id)
            continue

        try:
            webhook = await _ensure_webhook(channel, post.get("project_id"))
            embed = _build_embed(post)
            files = await _build_files(post)
            content = post.get("content") or ""
            # Discord требует непустой content, если нет ни эмбеда, ни файлов.
            if not content and embed is None and not files:
                content = "​"  # zero-width space
            msg = await webhook.send(
                content=content or discord.utils.MISSING,
                username=post.get("author_name") or discord.utils.MISSING,
                avatar_url=post.get("author_avatar_url") or discord.utils.MISSING,
                embeds=[embed] if embed else discord.utils.MISSING,
                files=files or discord.utils.MISSING,
                wait=True,
            )
            await api.mark_delivered(post["id"], msg.id)
            logger.info("Верд %s отправлен в канал %s", post["id"], channel_id)
        except Exception:  # noqa: BLE001
            logger.exception("Ошибка отправки верда %s", post["id"])


@deliver_posts.before_loop
async def _before_deliver() -> None:
    await bot.wait_until_ready()


@bot.event
async def on_ready() -> None:
    try:
        synced = await bot.tree.sync()
        logger.info("Синхронизировано команд: %d", len(synced))
    except discord.DiscordException:
        logger.exception("Не удалось синхронизировать команды")
    if not deliver_posts.is_running():
        deliver_posts.start()
    logger.info("Бот запущен как %s", bot.user)


# ---------- слэш-команды ----------
@bot.tree.command(name="me-info", description="Показать карточку вашей сущности")
async def me_info(interaction: discord.Interaction) -> None:
    if interaction.guild_id is None:
        await interaction.response.send_message("Команда доступна только на сервере.", ephemeral=True)
        return
    data = await api.me_info(interaction.guild_id, interaction.user.id)
    if data is None:
        await interaction.response.send_message(
            "За вами не закреплена сущность в этом проекте.", ephemeral=True
        )
        return
    embed = discord.Embed(title=data["label"], description=data["rendered"] or "—")
    await interaction.response.send_message(embed=embed, ephemeral=True)


@bot.tree.command(name="ping-master", description="Позвать мастера — уведомление уйдёт в дашборд")
@app_commands.describe(message="Короткое сообщение мастеру (необязательно)")
async def ping_master(interaction: discord.Interaction, message: str = "") -> None:
    if interaction.guild_id is None:
        await interaction.response.send_message("Команда доступна только на сервере.", ephemeral=True)
        return
    try:
        await api.ping(interaction.guild_id, interaction.user.id, interaction.channel_id, message)
    except Exception:  # noqa: BLE001
        await interaction.response.send_message("Проект для сервера не настроен.", ephemeral=True)
        return
    await interaction.response.send_message("Мастер уведомлён ✅", ephemeral=True)


class RegistrationModal(discord.ui.Modal):
    def __init__(self, form: dict[str, Any]) -> None:
        super().__init__(title=form.get("title", "Регистрация")[:45])
        self.form_id: int = form["id"]
        self._keys: list[str] = []
        # Discord Modal вмещает максимум 5 полей.
        for field in (form.get("fields") or [])[:5]:
            style = (
                discord.TextStyle.paragraph
                if field.get("type") == "paragraph"
                else discord.TextStyle.short
            )
            placeholder = ""
            if field.get("type") == "select" and field.get("options"):
                placeholder = "Варианты: " + ", ".join(field["options"])
            item = discord.ui.TextInput(
                label=field.get("label", field.get("key", "Поле"))[:45],
                required=bool(field.get("required")),
                style=style,
                placeholder=placeholder[:100],
                max_length=1000,
            )
            self.add_item(item)
            self._keys.append(field.get("key") or field.get("label") or "field")

    async def on_submit(self, interaction: discord.Interaction) -> None:
        answers = {
            key: item.value for key, item in zip(self._keys, self.children) if isinstance(item, discord.ui.TextInput)
        }
        try:
            await api.submit_registration(
                self.form_id, interaction.user.id, str(interaction.user), answers
            )
        except Exception:  # noqa: BLE001
            await interaction.response.send_message("Не удалось отправить заявку.", ephemeral=True)
            return
        await interaction.response.send_message("Заявка отправлена мастерам ✅", ephemeral=True)


@bot.tree.command(name="register", description="Подать заявку на регистрацию в проект")
async def register(interaction: discord.Interaction) -> None:
    if interaction.guild_id is None:
        await interaction.response.send_message("Команда доступна только на сервере.", ephemeral=True)
        return
    form = await api.open_form(interaction.guild_id)
    if form is None:
        await interaction.response.send_message(
            "Открытых форм регистрации нет.", ephemeral=True
        )
        return
    if not form.get("fields"):
        await interaction.response.send_message(
            "Форма пуста — обратитесь к мастеру.", ephemeral=True
        )
        return
    await interaction.response.send_modal(RegistrationModal(form))


def main() -> None:
    if not config.discord_token:
        raise SystemExit("DISCORD_BOT_TOKEN не задан")
    bot.run(config.discord_token)


if __name__ == "__main__":
    main()
