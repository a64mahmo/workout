import asyncio
import os
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine

load_dotenv('backend/.env')
url = os.getenv('DATABASE_URL')
print(f"Testing URL: {url}")

async def test():
    engine = create_async_engine(url)
    async with engine.connect() as conn:
        print("Connected successfully!")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(test())
