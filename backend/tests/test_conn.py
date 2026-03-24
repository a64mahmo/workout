import pytest
import os
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine

# Load .env from the backend directory
load_dotenv('backend/.env')

@pytest.mark.asyncio
async def test_db_connection():
    url = os.getenv('DATABASE_URL')
    assert url is not None, "DATABASE_URL environment variable is not set"
    
    engine = create_async_engine(url)
    try:
        async with engine.connect() as conn:
            print("Connected successfully to the database!")
            assert True # Connection was successful
    except Exception as e:
        pytest.fail(f"Could not connect to the database: {e}")
    finally:
        await engine.dispose()