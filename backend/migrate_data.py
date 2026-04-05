import asyncio
import logging
import sys
import os

# Add the project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), ".")))

from app.database import migrate_exercise_ownership, migrate_volume_history, init_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def main():
    logger.info("Starting data migrations...")
    
    # Ensure tables exist
    await init_db()
    
    # Run migrations
    await migrate_exercise_ownership()
    await migrate_volume_history()
    
    logger.info("Data migrations complete.")

if __name__ == "__main__":
    asyncio.run(main())
