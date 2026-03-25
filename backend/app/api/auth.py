from fastapi import APIRouter, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from passlib.context import CryptContext
from ..database import async_session
from ..models.models import User
from ..schemas import UserCreate, UserLogin, UserResponse, TokenResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

@router.post("/register", response_model=TokenResponse)
async def register(user: UserCreate):
    async with async_session() as session:
        result = await session.execute(select(User).where(User.email == user.email))
        if result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Email already registered")
        
        hashed = pwd_context.hash(user.password)
        new_user = User(email=user.email, name=user.name, hashed_password=hashed)
        session.add(new_user)
        await session.commit()
        return TokenResponse(user_id=new_user.id, message="User registered successfully")

@router.post("/login", response_model=TokenResponse)
async def login(user: UserLogin, x_user_id: str = Header(None)):
    async with async_session() as session:
        result = await session.execute(select(User).where(User.email == user.email))
        db_user = result.scalar_one_or_none()
        if not db_user or not pwd_context.verify(user.password, db_user.hashed_password):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        return TokenResponse(user_id=db_user.id, message="Login successful")

@router.get("/me", response_model=UserResponse)
async def get_me(x_user_id: str = Header(...)):
    async with async_session() as session:
        result = await session.execute(select(User).where(User.id == x_user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return UserResponse(
            id=user.id,
            email=user.email,
            name=user.name,
            created_at=user.created_at,
            has_fitbit_connected=bool(user.fitbit_access_token)
        )
