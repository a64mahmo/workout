import os
from fastapi import Request, HTTPException
from jose import JWTError, jwt

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "workout-tracker-dev-secret-change-in-production")
ALGORITHM = "HS256"


async def get_current_user_id(request: Request) -> str:
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user_id
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
