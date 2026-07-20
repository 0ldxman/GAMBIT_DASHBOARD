from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Project
from app.schemas import ProjectCreate
from app.schemas import ProjectOut
from app.schemas import ProjectUpdate
from app.security import require_master

router = APIRouter(prefix="/projects", tags=["projects"], dependencies=[Depends(require_master)])


async def get_project_or_404(project_id: int, db: AsyncSession) -> Project:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Проект не найден")
    return project


@router.get("", response_model=list[ProjectOut])
async def list_projects(db: AsyncSession = Depends(get_db)) -> list[Project]:
    result = await db.execute(select(Project).order_by(Project.created_at.desc()))
    return list(result.scalars().all())


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(body: ProjectCreate, db: AsyncSession = Depends(get_db)) -> Project:
    project = Project(**body.model_dump())
    db.add(project)
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
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
    await db.commit()
    await db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: int, db: AsyncSession = Depends(get_db)) -> None:
    project = await get_project_or_404(project_id, db)
    await db.delete(project)
    await db.commit()
