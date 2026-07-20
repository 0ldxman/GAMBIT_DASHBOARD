import hmac

from fastapi import Depends
from fastapi import Header
from fastapi import HTTPException
from fastapi import status
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.security import HTTPBearer
from itsdangerous import BadSignature
from itsdangerous import SignatureExpired
from itsdangerous import TimestampSigner

from app.config import get_settings

settings = get_settings()
_signer = TimestampSigner(settings.secret_key)

# Полезная нагрузка токена не важна (пользователь один — «мастер»);
# токен подтверждает лишь факт знания общего пароля.
_TOKEN_SUBJECT = "master"

_bearer = HTTPBearer(auto_error=False)


def verify_password(candidate: str) -> bool:
    """Сравнение общего пароля в постоянное время."""
    return hmac.compare_digest(candidate, settings.master_password)


def issue_token() -> str:
    return _signer.sign(_TOKEN_SUBJECT.encode()).decode()


def _valid_token(token: str) -> bool:
    try:
        _signer.unsign(token, max_age=settings.session_ttl_seconds)
        return True
    except (BadSignature, SignatureExpired):
        return False


async def require_master(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """Зависимость: пропускает только с валидным сессионным токеном."""
    if creds is None or not _valid_token(creds.credentials):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Требуется авторизация мастера",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _TOKEN_SUBJECT


async def require_internal(x_internal_key: str = Header(default="")) -> None:
    """Зависимость для /internal/* — проверяет общий секрет бота."""
    if not hmac.compare_digest(x_internal_key, settings.internal_api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный internal-ключ"
        )
