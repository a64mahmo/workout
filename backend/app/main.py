from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api import (
    auth_router, exercises_router, meso_cycles_router,
    sessions_router, suggestions_router, plans_router
)
from .database import init_db

app = FastAPI(
    title="Workout Tracker API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(exercises_router)
app.include_router(meso_cycles_router)
app.include_router(sessions_router)
app.include_router(suggestions_router)
app.include_router(plans_router)

@app.on_event("startup")
async def startup():
    await init_db()

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "workout-tracker-api"}
