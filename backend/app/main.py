from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from typing import AsyncIterator
from .api import (
    auth_router, exercises_router, meso_cycles_router,
    sessions_router, suggestions_router, plans_router
)
from .database import init_db

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Initialize the database on startup
    await init_db()
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
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(exercises_router)
app.include_router(meso_cycles_router)
app.include_router(sessions_router)
app.include_router(suggestions_router)
app.include_router(plans_router)



@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "workout-tracker-api"}
