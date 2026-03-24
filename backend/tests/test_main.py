import pytest
from httpx import AsyncClient, ASGITransport
from fastapi import FastAPI

# It's important to import the app from the correct module
from app.main import app as main_app

@pytest.fixture
def app() -> FastAPI:
    """
    Fixture to provide the FastAPI app instance.
    """
    return main_app

@pytest.mark.asyncio
async def test_health_check(app: FastAPI):
    """
    Tests the /api/health endpoint.
    """
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "healthy", "service": "workout-tracker-api"}
