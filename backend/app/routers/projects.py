from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.discord_api import DiscordError
from app.discord_api import list_guild_channels
from app.models import Entity
from app.models import EntityMember
from app.models import Project
from app.models import ProjectChannel
from app.models import ProjectRole
from app.schemas import ProjectCreate
from app.schemas import ProjectOut
from app.schemas import ProjectStats
from app.schemas import ProjectRoleCreate
from app.schemas import ProjectRoleOut
from app.schemas import ProjectRoleUpdate
from app.schemas import ProjectUpdate
from app.security import require_master

router = APIRouter(prefix="/projects", tags=["projects"], dependencies=[Depends(require_master)])


async def get_project_or_404(project_id: int, db: AsyncSession) -> Project:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Проект не найден")
    return project


async def _category_names(guild_id: int | None, ids: list[int]) -> dict[int, str]:
    """Имена категорий с сервера. Discord недоступен — обойдёмся без имён."""
    if not guild_id or not ids:
        return {}
    try:
        channels = await list_guild_channels(guild_id)
    except DiscordError:
        return {}
    wanted = set(ids)
    return {
        int(c["channel_id"]): c["name"]
        for c in channels
        if int(c["channel_id"]) in wanted
    }


async def _set_categories(project: Project, category_ids: list[int], db: AsyncSession) -> None:
    """Привести набор категорий проекта к указанному.

    Категории живут в project_channel с channel_type='category'. Обычные каналы,
    зарегистрированные отдельно, не трогаем.
    """
    result = await db.execute(
        select(ProjectChannel).where(
            ProjectChannel.project_id == project.id,
            ProjectChannel.channel_type == "category",
        )
    )
    current = {c.channel_id: c for c in result.scalars().all()}
    wanted = set(category_ids)

    for channel_id, row in current.items():
        if channel_id not in wanted:
            await db.delete(row)

    new_ids = [cid for cid in wanted if cid not in current]
    names = await _category_names(project.guild_id, new_ids)
    for channel_id in new_ids:
        db.add(
            ProjectChannel(
                project_id=project.id,
                channel_id=channel_id,
                channel_type="category",
                label=names.get(channel_id, ""),
            )
        )


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    guild_id: int | None = None, db: AsyncSession = Depends(get_db)
) -> list[Project]:
    query = select(Project)
    if guild_id is not None:
        query = query.where(Project.guild_id == guild_id)
    result = await db.execute(query.order_by(Project.created_at.desc()))
    return list(result.scalars().all())


@router.get("/stats", response_model=list[ProjectStats])
async def project_stats(
    guild_id: int | None = None, db: AsyncSession = Depends(get_db)
) -> list[ProjectStats]:
    """Сущности и уникальные игроки по проектам — для карточек на экране сервера."""
    query = (
        select(
            Entity.project_id,
            func.count(func.distinct(Entity.id)),
            func.count(func.distinct(EntityMember.player_id)),
        )
        .outerjoin(EntityMember, EntityMember.entity_id == Entity.id)
        .group_by(Entity.project_id)
    )
    if guild_id is not None:
        query = query.join(Project, Project.id == Entity.project_id).where(
            Project.guild_id == guild_id
        )
    result = await db.execute(query)
    return [
        ProjectStats(project_id=pid, entity_count=entities, player_count=players)
        for pid, entities, players in result.all()
    ]


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(body: ProjectCreate, db: AsyncSession = Depends(get_db)) -> Project:
    data = body.model_dump()
    category_ids = data.pop("category_ids", [])
    project = Project(**data)
    db.add(project)
    await db.flush()  # нужен project.id до создания категорий
    await _set_categories(project, category_ids, db)
    await db.commit()
    await db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project_id: int, db: AsyncSession = Depends(get_db)) -> Project:
    return await get_project_or_404(project_id, db)


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: int, body: ProjectUpdate, db: AsyncSession = Depends(get_db)
) -> Project:
    project = await get_project_or_404(project_id, db)
    data = body.model_dump(exclude_unset=True)
    category_ids = data.pop("category_ids", None)
    for field, value in data.items():
        setattr(project, field, value)
    if category_ids is not None:
        await _set_categories(project, category_ids, db)
    await db.commit()
    await db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: int, db: AsyncSession = Depends(get_db)) -> None:
    project = await get_project_or_404(project_id, db)
    await db.delete(project)
    await db.commit()


# ---------- категории проекта ----------
@router.get("/{project_id}/categories", response_model=list[str])
async def list_categories(project_id: int, db: AsyncSession = Depends(get_db)) -> list[str]:
    """Discord-id категорий проекта строками (snowflake не влезает в JS number)."""
    await get_project_or_404(project_id, db)
    result = await db.execute(
        select(ProjectChannel.channel_id).where(
            ProjectChannel.project_id == project_id,
            ProjectChannel.channel_type == "category",
        )
    )
    return [str(row[0]) for row in result.all()]


# ---------- роли проекта ----------
@router.get("/{project_id}/roles", response_model=list[ProjectRoleOut])
async def list_roles(project_id: int, db: AsyncSession = Depends(get_db)) -> list[ProjectRole]:
    await get_project_or_404(project_id, db)
    result = await db.execute(
        select(ProjectRole).where(ProjectRole.project_id == project_id).order_by(ProjectRole.id)
    )
    return list(result.scalars().all())


@router.post("/{project_id}/roles", response_model=ProjectRoleOut, status_code=status.HTTP_201_CREATED)
async def add_role(
    project_id: int, body: ProjectRoleCreate, db: AsyncSession = Depends(get_db)
) -> ProjectRole:
    await get_project_or_404(project_id, db)
    existing = await db.execute(
        select(ProjectRole).where(
            ProjectRole.project_id == project_id, ProjectRole.role_id == body.role_id
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Эта роль уже добавлена в проект"
        )
    role = ProjectRole(project_id=project_id, **body.model_dump())
    db.add(role)
    await db.commit()
    await db.refresh(role)
    return role


@router.patch("/{project_id}/roles/{role_pk}", response_model=ProjectRoleOut)
async def update_role(
    project_id: int, role_pk: int, body: ProjectRoleUpdate, db: AsyncSession = Depends(get_db)
) -> ProjectRole:
    role = await db.get(ProjectRole, role_pk)
    if role is None or role.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Роль не найдена")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(role, field, value)
    await db.commit()
    await db.refresh(role)
    return role


@router.delete("/{project_id}/roles/{role_pk}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(project_id: int, role_pk: int, db: AsyncSession = Depends(get_db)) -> None:
    role = await db.get(ProjectRole, role_pk)
    if role is None or role.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Роль не найдена")
    await db.delete(role)
    await db.commit()
