import os
import asyncio
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from typing import AsyncIterator
from .api import (
    auth_router, exercises_router, meso_cycles_router,
    sessions_router, suggestions_router, plans_router,
    fitbit_router
)
from .database import init_db

logger = logging.getLogger(__name__)

ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:5173"
).split(",")

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    for attempt in range(10):
        try:
            await init_db()
            logger.info("Database initialized successfully")
            break
        except Exception as e:
            wait = 2 ** attempt
            logger.error(f"DB init failed (attempt {attempt + 1}/10): {e}. Retrying in {wait}s...")
            await asyncio.sleep(wait)
    else:
        logger.critical("Could not connect to database after 10 attempts. Starting anyway.")
    
    yield


app = FastAPI(
    title="Workout Tracker API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(exercises_router)
app.include_router(meso_cycles_router)
app.include_router(sessions_router)
app.include_router(suggestions_router)
app.include_router(plans_router)
app.include_router(fitbit_router)



@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "workout-tracker-api"}
