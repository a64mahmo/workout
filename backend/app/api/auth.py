import os
from collections import defaultdict
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Response, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from passlib.context import CryptContext
from jose import jwt
from ..database import async_session
from ..models.models import User
from ..schemas import UserCreate, UserLogin, UserResponse, TokenResponse
from ..deps import get_current_user_id, SECRET_KEY, ALGORITHM
from ..services.program_seed import seed_programs_for_user

router = APIRouter(prefix="/api/auth", tags=["auth"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ACCESS_TOKEN_EXPIRE_HOURS = 24
_login_attempts: dict[str, list] = defaultdict(list)


def _check_rate_limit(ip: str) -> None:
    now = datetime.utcnow()
    window = now - timedelta(minutes=15)
    recent = [t for t in _login_attempts[ip] if t > window]
    if len(recent) >= 5:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Try again in 15 minutes.",
        )
    recent.append(now)
    _login_attempts[ip] = recent


def _create_token(user_id: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    return jwt.encode({"sub": user_id, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def _set_auth_cookie(response: Response, token: str) -> None:
    is_production = os.getenv("RAILWAY_ENVIRONMENT") is not None
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=is_production,
        max_age=86400,
        path="/",
    )


@router.post("/register", response_model=TokenResponse)
async def register(user: UserCreate, response: Response):
    async with async_session() as session:
        result = await session.execute(select(User).where(User.email == user.email))
        if result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Email already registered")

        hashed = pwd_context.hash(user.password)
        new_user = User(email=user.email, name=user.name, hashed_password=hashed)
        session.add(new_user)
        await session.commit()
        await session.refresh(new_user)

        token = _create_token(new_user.id)
        _set_auth_cookie(response, token)

        # Seed default programs in the background — don't fail registration if this errors
        try:
            async with async_session() as seed_session:
                await seed_programs_for_user(new_user.id, seed_session)
        except Exception:
            pass

        return TokenResponse(user_id=new_user.id, message="User registered successfully")


@router.post("/login", response_model=TokenResponse)
async def login(user: UserLogin, response: Response, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    async with async_session() as session:
        result = await session.execute(select(User).where(User.email == user.email))
        db_user = result.scalar_one_or_none()
        if not db_user or not pwd_context.verify(user.password, db_user.hashed_password):
            raise HTTPException(status_code=401, detail="Invalid credentials")

        token = _create_token(db_user.id)
        _set_auth_cookie(response, token)
        return TokenResponse(user_id=db_user.id, message="Login successful")


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(key="access_token", path="/")
    return {"message": "Logged out"}


@router.get("/me", response_model=UserResponse)
async def get_me(user_id: str = Depends(get_current_user_id)):
    async with async_session() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return UserResponse(
            id=user.id,
            email=user.email,
            name=user.name,
            created_at=user.created_at,
            has_fitbit_connected=bool(user.fitbit_access_token),
        )
