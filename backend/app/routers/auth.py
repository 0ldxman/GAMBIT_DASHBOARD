from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status

from app.schemas import LoginRequest
from app.schemas import TokenResponse
from app.security import issue_token
from app.security import require_master
from app.security import verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest) -> TokenResponse:
    if not verify_password(body.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный пароль"
        )
    return TokenResponse(access_token=issue_token())


@router.get("/me")
async def me(_: str = Depends(require_master)) -> dict[str, str]:
    """Проверка валидности токена."""
    return {"role": "master"}
