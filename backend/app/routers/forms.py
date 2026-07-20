from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Registration
from app.models import RegistrationForm
from app.models import RegistrationStatus
from app.routers.projects import get_project_or_404
from app.schemas import RegistrationFormCreate
from app.schemas import RegistrationFormOut
from app.schemas import RegistrationFormUpdate
from app.schemas import RegistrationOut
from app.security import require_master

router = APIRouter(
    prefix="/projects/{project_id}/forms",
    tags=["forms"],
    dependencies=[Depends(require_master)],
)


async def get_form_or_404(project_id: int, form_id: int, db: AsyncSession) -> RegistrationForm:
    form = await db.get(RegistrationForm, form_id)
    if form is None or form.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Форма не найдена")
    return form


@router.get("", response_model=list[RegistrationFormOut])
async def list_forms(project_id: int, db: AsyncSession = Depends(get_db)) -> list[RegistrationForm]:
    await get_project_or_404(project_id, db)
    result = await db.execute(
        select(RegistrationForm).where(RegistrationForm.project_id == project_id)
    )
    return list(result.scalars().all())


@router.post("", response_model=RegistrationFormOut, status_code=status.HTTP_201_CREATED)
async def create_form(
    project_id: int, body: RegistrationFormCreate, db: AsyncSession = Depends(get_db)
) -> RegistrationForm:
    await get_project_or_404(project_id, db)
    data = body.model_dump()
    data["fields"] = [f.model_dump() for f in body.fields]
    form = RegistrationForm(project_id=project_id, **data)
    db.add(form)
    await db.commit()
    await db.refresh(form)
    return form


@router.patch("/{form_id}", response_model=RegistrationFormOut)
async def update_form(
    project_id: int, form_id: int, body: RegistrationFormUpdate, db: AsyncSession = Depends(get_db)
) -> RegistrationForm:
    form = await get_form_or_404(project_id, form_id, db)
    data = body.model_dump(exclude_unset=True)
    if "fields" in data and data["fields"] is not None:
        data["fields"] = [f.model_dump() if hasattr(f, "model_dump") else f for f in data["fields"]]
    for field, value in data.items():
        setattr(form, field, value)
    await db.commit()
    await db.refresh(form)
    return form


@router.delete("/{form_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_form(project_id: int, form_id: int, db: AsyncSession = Depends(get_db)) -> None:
    form = await get_form_or_404(project_id, form_id, db)
    await db.delete(form)
    await db.commit()


@router.get("/{form_id}/registrations", response_model=list[RegistrationOut])
async def list_registrations(
    project_id: int, form_id: int, db: AsyncSession = Depends(get_db)
) -> list[Registration]:
    await get_form_or_404(project_id, form_id, db)
    result = await db.execute(
        select(Registration)
        .where(Registration.form_id == form_id)
        .order_by(Registration.created_at.desc())
    )
    return list(result.scalars().all())
