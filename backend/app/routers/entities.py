import logging
from copy import deepcopy

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy import and_
from sqlalchemy import or_
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.access import sync_channel_access
from app.access import sync_entity_channels
from app.computed import merge
from app.computed import validate as validate_computed
from app.database import get_db
from app.descriptions import entity_computed
from app.descriptions import render_entity_card
from app.discord_api import DiscordError
from app.discord_api import get_guild_member
from app.models import Entity
from app.models import EntityChannel
from app.models import EntityMember
from app.models import EntityRelation
from app.models import EntityType
from app.models import Project
from app.routers.projects import get_project_or_404
from app.schemas import ComputedValueOut
from app.schemas import EntityChannelCreate
from app.schemas import EntityChannelOut
from app.schemas import EntityChannelUpdate
from app.schemas import EntityCreate
from app.schemas import EntityOut
from app.schemas import EntityUpdate
from app.schemas import MemberCreate
from app.schemas import MemberOut
from app.schemas import MemberUpdate
from app.schemas import RelationCreate
from app.schemas import RelationOut
from app.schemas import RelationUpdate
from app.schemas import RenderedPage
from app.schemas import TemplatePagesResponse
from app.security import require_master
from app.templating import PAGE_SOFT_LIMIT
from app.templating import format_number

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/entities",
    tags=["entities"],
    dependencies=[Depends(require_master)],
)


async def get_entity_or_404(project_id: int, entity_id: int, db: AsyncSession) -> Entity:
    result = await db.execute(
        select(Entity)
        .where(Entity.id == entity_id, Entity.project_id == project_id)
        .options(selectinload(Entity.members))
    )
    entity = result.scalar_one_or_none()
    if entity is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сущность не найдена")
    return entity


async def _check_computed(
    project_id: int, type_id: int | None, computed: list | None, db: AsyncSession
) -> None:
    """Проверить собственные формулы сущности ВМЕСТЕ с формулами её типа.

    По отдельности они корректны, а вместе могут конфликтовать: сущность заводит
    `бюджет`, когда у типа уже есть `бюджет.деньги`, — путь оказывается сразу и
    значением, и веткой. Ловить это надо при сохранении, а не при рендере.
    """
    if not computed:
        return
    type_fields: list = []
    if type_id is not None:
        entity_type = await db.get(EntityType, type_id)
        if entity_type is not None and entity_type.project_id == project_id:
            type_fields = entity_type.computed or []
    err = validate_computed(merge(type_fields, computed))
    if err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Вычисляемые поля: {err}",
        )


async def _resolve_profile(project: Project, player_id: int) -> tuple[str, str]:
    """Имя и аватар игрока из Discord. Профиль — не критичен, ошибку глушим."""
    if not project.guild_id:
        return "", ""
    try:
        member = await get_guild_member(project.guild_id, player_id)
        return member["name"], member["avatar_url"]
    except DiscordError:
        logger.warning("Не удалось получить профиль игрока %s", player_id)
        return "", ""


# ---------- сущности ----------
@router.get("", response_model=list[EntityOut])
async def list_entities(project_id: int, db: AsyncSession = Depends(get_db)) -> list[Entity]:
    await get_project_or_404(project_id, db)
    result = await db.execute(
        select(Entity)
        .where(Entity.project_id == project_id)
        .options(selectinload(Entity.members))
        .order_by(Entity.label)
    )
    return list(result.scalars().all())


@router.post("", response_model=EntityOut, status_code=status.HTTP_201_CREATED)
async def create_entity(
    project_id: int, body: EntityCreate, db: AsyncSession = Depends(get_db)
) -> Entity:
    await get_project_or_404(project_id, db)
    data = body.model_dump()
    await _check_computed(project_id, data.get("type_id"), data.get("computed"), db)

    # Пустые атрибуты + указанный тип → начинаем с заготовки типа. Копируем
    # глубоко, иначе все сущности типа делили бы один и тот же вложенный объект.
    if not data.get("attributes") and data.get("type_id") is not None:
        entity_type = await db.get(EntityType, data["type_id"])
        if entity_type is not None and entity_type.project_id == project_id:
            data["attributes"] = deepcopy(entity_type.attributes_schema or {})

    entity = Entity(project_id=project_id, **data)
    db.add(entity)
    await db.commit()
    return await get_entity_or_404(project_id, entity.id, db)


@router.get("/{entity_id}", response_model=EntityOut)
async def get_entity(
    project_id: int, entity_id: int, db: AsyncSession = Depends(get_db)
) -> Entity:
    return await get_entity_or_404(project_id, entity_id, db)


@router.patch("/{entity_id}", response_model=EntityOut)
async def update_entity(
    project_id: int, entity_id: int, body: EntityUpdate, db: AsyncSession = Depends(get_db)
) -> Entity:
    entity = await get_entity_or_404(project_id, entity_id, db)
    data = body.model_dump(exclude_unset=True)
    # Смена типа тоже перепроверяет формулы: список типовых стал другим.
    if "computed" in data or "type_id" in data:
        await _check_computed(
            project_id,
            data.get("type_id", entity.type_id),
            data.get("computed", entity.computed),
            db,
        )
    for field, value in data.items():
        setattr(entity, field, value)
    await db.commit()
    return await get_entity_or_404(project_id, entity_id, db)


@router.delete("/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entity(
    project_id: int, entity_id: int, db: AsyncSession = Depends(get_db)
) -> None:
    entity = await get_entity_or_404(project_id, entity_id, db)
    # Каналы сущности не удаляем (отыгрыш остаётся в архиве), но снимаем доступ:
    # запоминаем их до удаления, чтобы пересчитать права после.
    result = await db.execute(
        select(EntityChannel.discord_channel_id).where(EntityChannel.entity_id == entity_id)
    )
    channel_ids = [row[0] for row in result.all()]

    await db.delete(entity)
    await db.commit()

    for channel_id in channel_ids:
        try:
            await sync_channel_access(channel_id, db)
        except DiscordError as exc:
            logger.warning("Права канала %s не пересчитаны: %s", channel_id, exc)


@router.get("/{entity_id}/render", response_model=TemplatePagesResponse)
async def render_entity(
    project_id: int, entity_id: int, db: AsyncSession = Depends(get_db)
) -> TemplatePagesResponse:
    """Страницы карточки сущности — то же, что листает /me-info в Discord."""
    entity = await get_entity_or_404(project_id, entity_id, db)
    rendered, colors = await render_entity_card(entity, db)
    _, values = await entity_computed(entity, db)
    return TemplatePagesResponse(
        pages=[
            RenderedPage(
                rendered=text,
                length=len(text),
                over_limit=len(text) > PAGE_SOFT_LIMIT,
                color=color,
            )
            for text, color in zip(rendered, colors)
        ],
        limit=PAGE_SOFT_LIMIT,
        computed=[
            ComputedValueOut(
                path=item.path,
                label=item.label,
                text="" if item.value is None else format_number(item.value),
                error=item.error,
                source=item.source,
            )
            for item in values
        ],
    )


# ---------- участники ----------
@router.get("/{entity_id}/members", response_model=list[MemberOut])
async def list_members(
    project_id: int, entity_id: int, db: AsyncSession = Depends(get_db)
) -> list[EntityMember]:
    entity = await get_entity_or_404(project_id, entity_id, db)
    return sorted(entity.members, key=lambda m: (not m.is_primary, m.role))


@router.post("/{entity_id}/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
async def add_member(
    project_id: int, entity_id: int, body: MemberCreate, db: AsyncSession = Depends(get_db)
) -> EntityMember:
    entity = await get_entity_or_404(project_id, entity_id, db)
    if any(m.player_id == body.player_id for m in entity.members):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Игрок уже участник этой сущности"
        )
    project = await db.get(Project, project_id)
    name, avatar = await _resolve_profile(project, body.player_id)

    if body.is_primary:
        for m in entity.members:
            m.is_primary = False
    member = EntityMember(
        entity_id=entity_id,
        player_id=body.player_id,
        role=body.role,
        # Первый участник автоматически становится основным.
        is_primary=body.is_primary or not entity.members,
        player_name=name,
        player_avatar_url=avatar,
    )
    db.add(member)
    await db.commit()
    await db.refresh(member)
    await sync_entity_channels(entity_id, db)
    return member


@router.patch("/{entity_id}/members/{member_id}", response_model=MemberOut)
async def update_member(
    project_id: int,
    entity_id: int,
    member_id: int,
    body: MemberUpdate,
    db: AsyncSession = Depends(get_db),
) -> EntityMember:
    entity = await get_entity_or_404(project_id, entity_id, db)
    member = next((m for m in entity.members if m.id == member_id), None)
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Участник не найден")
    data = body.model_dump(exclude_unset=True)
    # Основной участник — ровно один: назначение снимает флаг с остальных.
    if data.get("is_primary"):
        for m in entity.members:
            m.is_primary = False
    for field, value in data.items():
        setattr(member, field, value)
    await db.commit()
    await db.refresh(member)
    return member


@router.delete("/{entity_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    project_id: int, entity_id: int, member_id: int, db: AsyncSession = Depends(get_db)
) -> None:
    entity = await get_entity_or_404(project_id, entity_id, db)
    member = next((m for m in entity.members if m.id == member_id), None)
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Участник не найден")
    was_primary = member.is_primary
    await db.delete(member)
    await db.flush()
    # Сущность не должна остаться без основного игрока.
    if was_primary:
        rest = [m for m in entity.members if m.id != member_id]
        if rest:
            rest[0].is_primary = True
    await db.commit()
    # Игрок теряет доступ к каналам, если не остался в них через другую сущность.
    await sync_entity_channels(entity_id, db)


# ---------- связи ----------
@router.get("/-/relations", response_model=list[RelationOut])
async def list_project_relations(
    project_id: int, db: AsyncSession = Depends(get_db)
) -> list[EntityRelation]:
    """Все связи проекта разом — для графа и экрана связей.

    Путь с «-» вместо id: обычные ручки связей висят на конкретной сущности,
    а этой нужен весь проект.
    """
    await get_project_or_404(project_id, db)
    result = await db.execute(
        select(EntityRelation)
        .join(Entity, Entity.id == EntityRelation.parent_id)
        .where(Entity.project_id == project_id)
    )
    return list(result.scalars().all())


@router.get("/{entity_id}/relations", response_model=list[RelationOut])
async def list_relations(
    project_id: int, entity_id: int, db: AsyncSession = Depends(get_db)
) -> list[EntityRelation]:
    await get_entity_or_404(project_id, entity_id, db)
    result = await db.execute(
        select(EntityRelation).where(
            or_(EntityRelation.parent_id == entity_id, EntityRelation.child_id == entity_id)
        )
    )
    return list(result.scalars().all())


@router.post(
    "/{entity_id}/relations", response_model=RelationOut, status_code=status.HTTP_201_CREATED
)
async def add_relation(
    project_id: int, entity_id: int, body: RelationCreate, db: AsyncSession = Depends(get_db)
) -> EntityRelation:
    """Связать сущности: entity_id — первая сторона, child_id — вторая.

    Иерархия (`directed`) делает entity_id родителем; взаимная связь порядок
    сторон не значит ничем, кроме порядка записи.
    """
    await get_entity_or_404(project_id, entity_id, db)
    await get_entity_or_404(project_id, body.child_id, db)  # и что она из этого же проекта
    if body.child_id == entity_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Сущность не может быть связана сама с собой",
        )
    if body.directed and await _creates_cycle(entity_id, body.child_id, db):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Связь замкнула бы цикл в иерархии",
        )
    if not body.directed and await _mirror_exists(entity_id, body.child_id, body.relation_type, db):
        # У взаимной связи «А—Б» и «Б—А» — одно и то же, а уникальный индекс
        # смотрит только на точный порядок сторон и такой дубль пропустил бы.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Такая связь уже есть — она взаимная и видна с обеих сторон",
        )
    relation = EntityRelation(
        parent_id=entity_id,
        child_id=body.child_id,
        relation_type=body.relation_type,
        directed=body.directed,
    )
    db.add(relation)
    await db.commit()
    await db.refresh(relation)
    return relation


@router.patch("/{entity_id}/relations/{relation_id}", response_model=RelationOut)
async def update_relation(
    project_id: int,
    entity_id: int,
    relation_id: int,
    body: RelationUpdate,
    db: AsyncSession = Depends(get_db),
) -> EntityRelation:
    """Сменить тип связи или её род (иерархия ↔ взаимная)."""
    relation = await _relation_or_404(project_id, entity_id, relation_id, db)
    data = body.model_dump(exclude_unset=True)
    directed = data.get("directed", relation.directed)
    if directed and not relation.directed:
        if await _creates_cycle(relation.parent_id, relation.child_id, db):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Иерархия замкнула бы цикл",
            )
    for key, value in data.items():
        setattr(relation, key, value)
    await db.commit()
    await db.refresh(relation)
    return relation


async def _mirror_exists(
    parent_id: int, child_id: int, relation_type: str, db: AsyncSession
) -> bool:
    """Есть ли уже связь этого типа между теми же сторонами в любом порядке."""
    result = await db.execute(
        select(EntityRelation.id).where(
            EntityRelation.relation_type == relation_type,
            or_(
                and_(EntityRelation.parent_id == parent_id, EntityRelation.child_id == child_id),
                and_(EntityRelation.parent_id == child_id, EntityRelation.child_id == parent_id),
            ),
        )
    )
    return result.first() is not None


async def _creates_cycle(parent_id: int, child_id: int, db: AsyncSession) -> bool:
    """Станет ли parent потомком child (обход вверх от parent).

    Вверх ведут только иерархические связи: «союзник» — не подчинение, и круг
    союзов циклом не является.
    """
    seen: set[int] = set()
    frontier = [parent_id]
    while frontier:
        current = frontier.pop()
        if current == child_id:
            return True
        if current in seen:
            continue
        seen.add(current)
        result = await db.execute(
            select(EntityRelation.parent_id).where(
                EntityRelation.child_id == current, EntityRelation.directed.is_(True)
            )
        )
        frontier.extend(row[0] for row in result.all())
    return False


@router.delete("/{entity_id}/relations/{relation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_relation(
    project_id: int, entity_id: int, relation_id: int, db: AsyncSession = Depends(get_db)
) -> None:
    relation = await _relation_or_404(project_id, entity_id, relation_id, db)
    await db.delete(relation)
    await db.commit()


async def _relation_or_404(
    project_id: int, entity_id: int, relation_id: int, db: AsyncSession
) -> EntityRelation:
    """Связь, у которой entity_id — одна из сторон (любая: связь взаимная)."""
    await get_entity_or_404(project_id, entity_id, db)
    relation = await db.get(EntityRelation, relation_id)
    if relation is None or entity_id not in (relation.parent_id, relation.child_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Связь не найдена")
    return relation


# ---------- каналы сущности ----------
@router.get("/{entity_id}/channels", response_model=list[EntityChannelOut])
async def list_entity_channels(
    project_id: int, entity_id: int, db: AsyncSession = Depends(get_db)
) -> list[EntityChannel]:
    await get_entity_or_404(project_id, entity_id, db)
    result = await db.execute(
        select(EntityChannel).where(EntityChannel.entity_id == entity_id)
    )
    return list(result.scalars().all())


@router.post(
    "/{entity_id}/channels", response_model=EntityChannelOut, status_code=status.HTTP_201_CREATED
)
async def link_channel(
    project_id: int, entity_id: int, body: EntityChannelCreate, db: AsyncSession = Depends(get_db)
) -> EntityChannel:
    await get_entity_or_404(project_id, entity_id, db)
    link = EntityChannel(
        entity_id=entity_id,
        discord_channel_id=body.discord_channel_id,
        label=body.label,
        sync_access=body.sync_access,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    if link.sync_access:
        try:
            await sync_channel_access(link.discord_channel_id, db)
        except DiscordError as exc:
            logger.warning("Доступ к каналу %s не синхронизирован: %s", link.discord_channel_id, exc)
    return link


@router.patch("/{entity_id}/channels/{link_id}", response_model=EntityChannelOut)
async def update_entity_channel(
    project_id: int,
    entity_id: int,
    link_id: int,
    body: EntityChannelUpdate,
    db: AsyncSession = Depends(get_db),
) -> EntityChannel:
    await get_entity_or_404(project_id, entity_id, db)
    link = await db.get(EntityChannel, link_id)
    if link is None or link.entity_id != entity_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Привязка не найдена")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(link, field, value)
    await db.commit()
    await db.refresh(link)
    if link.sync_access:
        try:
            await sync_channel_access(link.discord_channel_id, db)
        except DiscordError as exc:
            logger.warning("Доступ к каналу %s не синхронизирован: %s", link.discord_channel_id, exc)
    return link


@router.delete("/{entity_id}/channels/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_channel(
    project_id: int, entity_id: int, link_id: int, db: AsyncSession = Depends(get_db)
) -> None:
    """Отвязать канал. Сам канал в Discord остаётся — удаляется только связь."""
    await get_entity_or_404(project_id, entity_id, db)
    link = await db.get(EntityChannel, link_id)
    if link is None or link.entity_id != entity_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Привязка не найдена")
    channel_id = link.discord_channel_id
    await db.delete(link)
    await db.commit()
    try:
        await sync_channel_access(channel_id, db)
    except DiscordError as exc:
        logger.warning("Права канала %s не пересчитаны: %s", channel_id, exc)
