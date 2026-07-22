"""Gambit Dashboard — Discord-бот.

Обязанности:
  1. Доставка вердов: опрашивает backend, отправляет опубликованные верды через
     вебхук (создаёт/переиспользует), с подменой имени/аватара автора и опц. эмбедом.
  2. Слэш-команды: /about, /me-info, /ping-master, /register (модалка из формы проекта).
  3. Речь от лица сущности: команда /say и авто-подмена сообщений в каналах,
     где мастер её включил (/say-as выбирает сущность, когда их несколько).

ВАЖНО: авто-подмене нужен MESSAGE CONTENT INTENT (Developer Portal → Bot →
Privileged Gateway Intents). Без него бот не видит текст сообщений и подменять
их не сможет — команда /say при этом продолжит работать.
"""

import io
import logging
from pathlib import Path
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
# Нужен авто-подмене: без него сообщения приходят с пустым content.
intents.message_content = config.message_content
bot = commands.Bot(command_prefix="!", intents=intents)
api = ApiClient()

# Discord режет content сообщения на 2000 символах.
MESSAGE_LIMIT = 2000
# Каналы с авто-подменой. Список обновляется задачей ниже, чтобы не ходить
# в backend на каждое сообщение сервера.
proxy_channel_ids: set[int] = set()


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
    # Автор эмбеда независим от отправителя: пусто — строки автора нет вовсе,
    # нет иконки — автор пишется без неё.
    if post.get("embed_author_name"):
        embed.set_author(
            name=post["embed_author_name"],
            icon_url=post.get("embed_author_icon_url") or None,
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


async def _webhook_target(
    channel: discord.abc.Messageable, project_id: Optional[int]
) -> tuple[discord.Webhook, Any]:
    """Вебхук и ветка для отправки. У ветки своего вебхука нет — берём родительский."""
    thread = discord.utils.MISSING
    if isinstance(channel, discord.Thread):
        parent = channel.parent
        if parent is None:
            raise RuntimeError("Ветка без родительского канала")
        thread = channel
        channel = parent
    if not isinstance(channel, discord.TextChannel):
        raise RuntimeError("Канал не текстовый")
    return await _ensure_webhook(channel, project_id), thread


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
    if not refresh_proxy_channels.is_running():
        refresh_proxy_channels.start()
    logger.info("Бот запущен как %s", bot.user)


class PagesView(discord.ui.View):
    """Перелистывание страниц карточки кнопками.

    Показываем ровно один эмбед и меняем его на месте: пачка эмбедов сразу
    забивала бы канал и всё равно упиралась в предел в 10 штук на сообщение.
    """

    def __init__(self, embeds: list[discord.Embed], user_id: int) -> None:
        super().__init__(timeout=600)
        self.embeds = embeds
        self.user_id = user_id
        self.index = 0
        self._sync()

    def _sync(self) -> None:
        self.prev_page.disabled = self.index == 0
        self.next_page.disabled = self.index >= len(self.embeds) - 1
        self.counter.label = f"{self.index + 1} / {len(self.embeds)}"

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        # Карточка эфемерная, но кнопки всё равно закрываем: мало ли где её покажут.
        if interaction.user.id != self.user_id:
            await interaction.response.send_message("Это не ваша карточка.", ephemeral=True)
            return False
        return True

    async def _flip(self, interaction: discord.Interaction, delta: int) -> None:
        self.index = max(0, min(len(self.embeds) - 1, self.index + delta))
        self._sync()
        await interaction.response.edit_message(embed=self.embeds[self.index], view=self)

    @discord.ui.button(label="◀", style=discord.ButtonStyle.secondary)
    async def prev_page(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await self._flip(interaction, -1)

    @discord.ui.button(label="1 / 1", style=discord.ButtonStyle.secondary, disabled=True)
    async def counter(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        """Только счётчик — кнопка всегда выключена."""

    @discord.ui.button(label="▶", style=discord.ButtonStyle.secondary)
    async def next_page(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await self._flip(interaction, 1)


# ---------- слэш-команды ----------
@bot.tree.command(name="me-info", description="Показать карточку вашей сущности")
async def me_info(interaction: discord.Interaction) -> None:
    if interaction.guild_id is None:
        await interaction.response.send_message("Команда доступна только на сервере.", ephemeral=True)
        return
    data = await api.me_info(interaction.guild_id, interaction.user.id, interaction.channel_id)
    if data is None:
        await interaction.response.send_message(
            "За вами не закреплена сущность в этом проекте.", ephemeral=True
        )
        return

    # Описание может не влезть в один эмбед — мастер разбивает его на страницы.
    # Показываем по одной, остальные доступны кнопками.
    pages: list[str] = data.get("pages") or [data.get("rendered") or ""]
    # Цвет страницы задаёт мастер; пусто — оставляем цвет Discord по умолчанию.
    colors: list[str] = data.get("colors") or []
    embeds: list[discord.Embed] = []
    for index, page in enumerate(pages):
        embed = discord.Embed(title=data["label"], description=page or "—")
        color = colors[index] if index < len(colors) else ""
        if color:
            try:
                embed.colour = discord.Colour(int(color.lstrip("#"), 16))
            except ValueError:
                pass
        if data.get("picture_url"):
            embed.set_thumbnail(url=data["picture_url"])
        if len(pages) > 1:
            embed.set_footer(text=f"Страница {index + 1} из {len(pages)}")
        embeds.append(embed)

    view = PagesView(embeds, interaction.user.id) if len(embeds) > 1 else discord.utils.MISSING
    await interaction.response.send_message(embed=embeds[0], view=view, ephemeral=True)


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


async def _about_media(data: dict[str, Any]) -> tuple[Optional[discord.File], bool]:
    """Вложение карточки проекта: (файл, показывать ли внутри эмбеда).

    Картинки и гифки Discord умеет рисовать внутри эмбеда через attachment://,
    видео — нет: его он покажет отдельным плеером под сообщением.
    """
    url = data.get("media_url")
    if not url:
        return None, False
    try:
        blob = await api.fetch_attachment(url)
    except Exception:  # noqa: BLE001 — карточка важнее вложения
        logger.exception("Не удалось скачать вложение проекта %s", url)
        return None, False

    content_type = data.get("media_content_type") or ""
    inline = content_type.startswith("image/")
    # Имя для ссылки attachment:// берём простое: в исходном могут быть кириллица
    # и пробелы, из-за которых Discord не свяжет ссылку с файлом.
    suffix = Path(data.get("media_filename") or url).suffix or ".bin"
    name = f"about{suffix}"
    return discord.File(io.BytesIO(blob), filename=name), inline


@bot.tree.command(name="about", description="Показать информацию о проекте")
@app_commands.describe(project="Проект (по умолчанию — проект этого канала)")
async def about(interaction: discord.Interaction, project: Optional[str] = None) -> None:
    if interaction.guild_id is None:
        await interaction.response.send_message("Команда доступна только на сервере.", ephemeral=True)
        return

    project_id: Optional[int] = None
    if project:
        if not project.isdigit():
            await interaction.response.send_message(
                "Выберите проект из подсказки.", ephemeral=True
            )
            return
        project_id = int(project)

    await interaction.response.defer()
    try:
        data = await api.about(interaction.guild_id, interaction.channel_id, project_id)
    except Exception:  # noqa: BLE001
        logger.exception("Не удалось получить карточку проекта")
        await interaction.followup.send("Не удалось получить данные проекта.", ephemeral=True)
        return
    if data is None:
        await interaction.followup.send(
            "Проект не найден. Укажите его аргументом или выполните команду в канале проекта.",
            ephemeral=True,
        )
        return

    # Описание: сначала авторы, затем текст проекта.
    parts: list[str] = []
    if data.get("authors"):
        parts.append(f"**Авторы проекта**\n{data['authors']}")
    if data.get("desc"):
        parts.append(data["desc"])

    embed = discord.Embed(
        title=data["label"],
        description="\n\n".join(parts) or None,
        color=discord.Color.blurple(),
    )
    if data.get("type"):
        embed.set_footer(text=data["type"])

    media, inline = await _about_media(data)
    if media is not None and inline:
        embed.set_image(url=f"attachment://{media.filename}")

    await interaction.followup.send(
        embed=embed, file=media if media else discord.utils.MISSING
    )


@about.autocomplete("project")
async def about_autocomplete(
    interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    if interaction.guild_id is None:
        return []
    try:
        projects = await api.guild_projects(interaction.guild_id)
    except Exception:  # noqa: BLE001 — без подсказок команда всё ещё работает
        logger.exception("Не удалось получить проекты сервера")
        return []
    query = current.lower()
    return [
        app_commands.Choice(name=p["label"][:100], value=str(p["project_id"]))
        for p in projects
        if query in p["label"].lower()
    ][:25]


# ---------- речь от лица сущности ----------
async def _speak_as(
    channel: discord.abc.Messageable,
    entity: dict[str, Any],
    project_id: Optional[int],
    content: str,
    files: Optional[list[discord.File]] = None,
) -> None:
    """Отправить сообщение вебхуком: имя и аватарка — от сущности."""
    webhook, thread = await _webhook_target(channel, project_id)
    await webhook.send(
        content=content[:MESSAGE_LIMIT] or discord.utils.MISSING,
        username=entity["label"][:80],
        # Пустой picture_url — сущности не задали картинку либо backend не знает
        # своего публичного адреса; тогда уйдёт аватарка вебхука по умолчанию.
        avatar_url=entity.get("picture_url") or discord.utils.MISSING,
        files=files or discord.utils.MISSING,
        thread=thread,
        wait=False,
    )


class SayModal(discord.ui.Modal):
    """Ввод реплики. Модалка, а не аргумент команды: в ней есть переносы строк."""

    def __init__(self, entity: dict[str, Any], project_id: Optional[int]) -> None:
        super().__init__(title=f"От лица: {entity['label']}"[:45])
        self.entity = entity
        self.project_id = project_id
        self.text = discord.ui.TextInput(
            label="Сообщение",
            style=discord.TextStyle.paragraph,
            max_length=MESSAGE_LIMIT,
            required=True,
        )
        self.add_item(self.text)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        try:
            await _speak_as(
                interaction.channel, self.entity, self.project_id, str(self.text.value)
            )
        except (discord.DiscordException, RuntimeError):
            logger.exception("Не удалось отправить сообщение от лица сущности")
            await interaction.response.send_message(
                "Не удалось отправить сообщение. Проверьте, что у бота есть право "
                "«Управление вебхуками» в этом канале.",
                ephemeral=True,
            )
            return
        await interaction.response.send_message("Отправлено ✅", ephemeral=True)


class EntitySelect(discord.ui.Select):
    """Выбор сущности, когда доступ в канал даёт сразу несколько."""

    def __init__(self, ctx: dict[str, Any], remember: bool) -> None:
        options = [
            discord.SelectOption(label=c["label"][:100], value=str(c["entity_id"]))
            for c in ctx["candidates"][:25]
        ]
        super().__init__(placeholder="От чьего лица говорить…", options=options)
        self.ctx = ctx
        self.remember = remember

    async def callback(self, interaction: discord.Interaction) -> None:
        entity_id = int(self.values[0])
        entity = next(
            (c for c in self.ctx["candidates"] if c["entity_id"] == entity_id), None
        )
        if entity is None:
            await interaction.response.send_message("Сущность не найдена.", ephemeral=True)
            return
        if self.remember:
            await api.set_proxy_choice(
                interaction.guild_id, interaction.channel_id, interaction.user.id, entity_id
            )
            await interaction.response.send_message(
                f"В этом канале вы говорите от лица «{entity['label']}». "
                "Сменить — той же командой.",
                ephemeral=True,
            )
            return
        await interaction.response.send_modal(SayModal(entity, self.ctx.get("project_id")))


class EntityChoiceView(discord.ui.View):
    def __init__(self, ctx: dict[str, Any], remember: bool) -> None:
        super().__init__(timeout=120)
        self.add_item(EntitySelect(ctx, remember))


async def _proxy_ctx(interaction: discord.Interaction) -> Optional[dict[str, Any]]:
    """Контекст подмены для команды. None — отвечать уже не нужно."""
    if interaction.guild_id is None:
        await interaction.response.send_message("Команда доступна только на сервере.", ephemeral=True)
        return None
    try:
        ctx = await api.proxy_context(
            interaction.guild_id, interaction.channel_id or 0, interaction.user.id
        )
    except Exception:  # noqa: BLE001
        logger.exception("Не удалось получить контекст подмены")
        await interaction.response.send_message("Backend недоступен.", ephemeral=True)
        return None
    if ctx is None:
        await interaction.response.send_message(
            "Не удалось определить проект этого канала.", ephemeral=True
        )
        return None
    if not ctx["candidates"]:
        await interaction.response.send_message(
            "За вами не закреплена сущность в этом проекте.", ephemeral=True
        )
        return None
    return ctx


@bot.tree.command(name="say", description="Написать сообщение от лица своей сущности")
async def say(interaction: discord.Interaction) -> None:
    ctx = await _proxy_ctx(interaction)
    if ctx is None:
        return
    if ctx.get("entity"):
        await interaction.response.send_modal(SayModal(ctx["entity"], ctx.get("project_id")))
        return
    await interaction.response.send_message(
        "У вас несколько сущностей в этом канале — выберите, от чьего лица говорить:",
        view=EntityChoiceView(ctx, remember=False),
        ephemeral=True,
    )


@bot.tree.command(
    name="say-as", description="Выбрать сущность, от лица которой вы говорите в этом канале"
)
async def say_as(interaction: discord.Interaction) -> None:
    """Запоминает выбор — им пользуется и /say, и авто-подмена."""
    ctx = await _proxy_ctx(interaction)
    if ctx is None:
        return
    if len(ctx["candidates"]) == 1:
        await interaction.response.send_message(
            f"В этом канале у вас одна сущность — «{ctx['candidates'][0]['label']}». "
            "Выбирать не из чего.",
            ephemeral=True,
        )
        return
    await interaction.response.send_message(
        "От лица какой сущности вы говорите в этом канале?",
        view=EntityChoiceView(ctx, remember=True),
        ephemeral=True,
    )


@tasks.loop(seconds=60)
async def refresh_proxy_channels() -> None:
    global proxy_channel_ids
    try:
        ids = await api.proxy_channels()
    except Exception:  # noqa: BLE001 — старый список лучше пустого
        logger.exception("Не удалось обновить список каналов авто-подмены")
        return
    proxy_channel_ids = {int(i) for i in ids}


@refresh_proxy_channels.before_loop
async def _before_refresh() -> None:
    await bot.wait_until_ready()


@bot.event
async def on_message(message: discord.Message) -> None:
    """Авто-подмена: сообщение игрока переотправляется от лица его сущности."""
    if message.guild is None or message.author.bot or message.webhook_id is not None:
        return
    # Ветка наследует настройку родительского канала: отыгрыш часто уходит в ветки.
    channel = message.channel
    parent_id = channel.parent_id if isinstance(channel, discord.Thread) else None
    if channel.id not in proxy_channel_ids and parent_id not in proxy_channel_ids:
        return
    # Настройки и привязки сущностей живут на самом канале, а не на ветке.
    lookup_id = channel.id if channel.id in proxy_channel_ids else parent_id

    try:
        ctx = await api.proxy_context(message.guild.id, lookup_id, message.author.id)
    except Exception:  # noqa: BLE001
        logger.exception("Авто-подмена: backend недоступен")
        return
    if ctx is None or not ctx.get("auto_proxy") or not ctx["candidates"]:
        return

    if ctx.get("entity") is None:
        # Подменять наугад нельзя: сообщение уйдёт под чужим флагом. Просим выбрать.
        await channel.send(
            f"{message.author.mention}, в этом канале у вас несколько сущностей — "
            "выберите одну командой `/say-as`, иначе подмена не работает.",
            delete_after=20,
        )
        return

    files: list[discord.File] = []
    for attachment in message.attachments:
        try:
            files.append(await attachment.to_file())
        except discord.DiscordException:
            logger.warning("Вложение %s не перенесено", attachment.filename)

    # Переслать нечего (стикер, только эмбед) — вебхук такое не примет,
    # да и удалять исходное сообщение в этом случае незачем.
    if not message.content and not files:
        return

    try:
        await _speak_as(channel, ctx["entity"], ctx.get("project_id"), message.content, files)
    except (discord.DiscordException, RuntimeError):
        # Не смогли переотправить — исходное сообщение оставляем на месте.
        logger.exception("Авто-подмена не удалась в канале %s", channel.id)
        return
    try:
        await message.delete()
    except discord.DiscordException:
        logger.warning("Не удалось удалить исходное сообщение %s", message.id)


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
    form = await api.open_form(interaction.guild_id, interaction.channel_id)
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
    try:
        bot.run(config.discord_token)
    except discord.PrivilegedIntentsRequired:
        # Иначе в логах только стектрейс, из которого не видно, что чинить.
        raise SystemExit(
            "Discord не пустил бота: включите MESSAGE CONTENT INTENT в Developer "
            "Portal → Bot → Privileged Gateway Intents. Он нужен авто-подмене "
            "сообщений. Если она не нужна — запустите с BOT_MESSAGE_CONTENT=0."
        )


if __name__ == "__main__":
    main()
