"""Загрузка вложений для вердов.

Файлы кладутся на диск (том `uploads` в docker) и раздаются статикой по /uploads/...
Бот при отправке верда скачивает их по внутреннему URL и прикладывает к сообщению.
"""

import re
import secrets
from pathlib import Path

from fastapi import APIRouter
from fastapi import Depends
from fastapi import File
from fastapi import HTTPException
from fastapi import UploadFile
from fastapi import status

from app.config import get_settings
from app.routers.projects import get_project_or_404
from app.schemas import AttachmentOut
from app.security import require_master
from app.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(
    prefix="/projects/{project_id}/uploads",
    tags=["uploads"],
    dependencies=[Depends(require_master)],
)

settings = get_settings()
UPLOAD_ROOT = Path(settings.upload_dir)
MAX_BYTES = 25 * 1024 * 1024  # лимит вложения Discord для обычного сервера
_SAFE = re.compile(r"[^A-Za-z0-9А-Яа-яЁё._-]+")


def _safe_name(name: str) -> str:
    """Обезвредить имя файла: без путей, без спецсимволов, разумной длины."""
    base = Path(name or "file").name
    cleaned = _SAFE.sub("_", base).strip("._") or "file"
    return cleaned[:120]


@router.post("", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
async def upload_file(
    project_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
) -> AttachmentOut:
    await get_project_or_404(project_id, db)

    data = await file.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Пустой файл")
    if len(data) > MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Файл больше {MAX_BYTES // 1024 // 1024} МБ",
        )

    folder = UPLOAD_ROOT / str(project_id)
    folder.mkdir(parents=True, exist_ok=True)
    # Префикс не даёт файлам с одинаковыми именами затирать друг друга.
    stored = f"{secrets.token_hex(8)}_{_safe_name(file.filename or 'file')}"
    (folder / stored).write_bytes(data)

    return AttachmentOut(
        url=f"/uploads/{project_id}/{stored}",
        filename=file.filename or stored,
        size=len(data),
        content_type=file.content_type or "application/octet-stream",
    )
