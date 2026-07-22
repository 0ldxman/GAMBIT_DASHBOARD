"""Шаблоны вердов: заготовки полей, из которых собирается новый верд.

Шаблон хранит только те поля, которые мастер отметил при сохранении. Поэтому
«подпись МИДа» переносит отправителя и цвет эмбеда, но не тащит за собой текст
и канал прошлого верда.
"""

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import PostTemplate
from app.routers.projects import get_project_or_404
from app.schemas import PostTemplateCreate
from app.schemas import PostTemplateOut
from app.schemas import PostTemplateUpdate
from app.schemas import TemplateFieldOut
from app.security import require_master

router = APIRouter(
    prefix="/projects/{project_id}/post-templates",
    tags=["post-templates"],
    dependencies=[Depends(require_master)],
)

# Что вообще можно положить в шаблон. Порядок = порядок галочек в интерфейсе.
TEMPLATE_FIELDS: tuple[tuple[str, str], ...] = (
    ("target_channel_id", "Канал публикации"),
    ("author_name", "Автор сообщения"),
    ("author_avatar_url", "Картинка автора сообщения"),
    ("content", "Текст сообщения"),
    ("use_embed", "Эмбед включён"),
    ("embed_author_name", "Автор эмбеда"),
    ("embed_author_icon_url", "Картинка автора эмбеда"),
    ("embed_title", "Заголовок эмбеда"),
    ("embed_description", "Содержание эмбеда"),
    ("embed_image_url", "Картинка эмбеда"),
    ("embed_color", "Цвет эмбеда"),
)
FIELD_KEYS = {key for key, _ in TEMPLATE_FIELDS}


async def get_template_or_404(
    project_id: int, template_id: int, db: AsyncSession
) -> PostTemplate:
    tpl = await db.get(PostTemplate, template_id)
    if tpl is None or tpl.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Шаблон не найден")
    return tpl


@router.get("/fields", response_model=list[TemplateFieldOut])
async def template_fields(project_id: int) -> list[TemplateFieldOut]:
    """Список полей для галочек «что сохраняет шаблон»."""
    return [TemplateFieldOut(key=key, label=label) for key, label in TEMPLATE_FIELDS]


@router.get("", response_model=list[PostTemplateOut])
async def list_templates(
    project_id: int, db: AsyncSession = Depends(get_db)
) -> list[PostTemplate]:
    await get_project_or_404(project_id, db)
    result = await db.execute(
        select(PostTemplate)
        .where(PostTemplate.project_id == project_id)
        .order_by(PostTemplate.name)
    )
    return list(result.scalars().all())


@router.post("", response_model=PostTemplateOut, status_code=status.HTTP_201_CREATED)
async def create_template(
    project_id: int, body: PostTemplateCreate, db: AsyncSession = Depends(get_db)
) -> PostTemplate:
    await get_project_or_404(project_id, db)
    fields = [f for f in body.fields if f in FIELD_KEYS]
    if not fields:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Отметьте хотя бы одно поле, которое сохраняет шаблон",
        )

    # Значения берём из формы, а не из БД: шаблон должен повторять то, что
    # мастер видит на экране, включая ещё не сохранённые правки.
    data = {k: v for k, v in body.data.items() if k in fields}
    tpl = PostTemplate(project_id=project_id, name=body.name.strip() or "Шаблон",
                       fields=fields, data=data)
    db.add(tpl)
    await db.commit()
    await db.refresh(tpl)
    return tpl


@router.patch("/{template_id}", response_model=PostTemplateOut)
async def update_template(
    project_id: int,
    template_id: int,
    body: PostTemplateUpdate,
    db: AsyncSession = Depends(get_db),
) -> PostTemplate:
    tpl = await get_template_or_404(project_id, template_id, db)
    data = body.model_dump(exclude_unset=True)
    if "fields" in data:
        data["fields"] = [f for f in data["fields"] if f in FIELD_KEYS]
    for field, value in data.items():
        setattr(tpl, field, value)
    # Значения без своих полей шаблон только раздували бы.
    tpl.data = {k: v for k, v in (tpl.data or {}).items() if k in set(tpl.fields or [])}
    await db.commit()
    await db.refresh(tpl)
    return tpl


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    project_id: int, template_id: int, db: AsyncSession = Depends(get_db)
) -> None:
    tpl = await get_template_or_404(project_id, template_id, db)
    await db.delete(tpl)
    await db.commit()
