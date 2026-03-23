import asyncio
import uuid
import os
from sqlalchemy import select

from app.database import async_session, init_db
from app.models import Exercise, User

DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000000'

exercises_data = [
    {"name": "Barbell Bench Press", "muscle_group": "chest", "description": "Compound chest exercise"},
    {"name": "Incline Dumbbell Press", "muscle_group": "chest", "description": "Upper chest focus"},
    {"name": "Cable Fly", "muscle_group": "chest", "description": "Chest isolation exercise"},
    {"name": "Pull-ups", "muscle_group": "back", "description": "Compound back exercise"},
    {"name": "Barbell Row", "muscle_group": "back", "description": "Back thickness"},
    {"name": "Lat Pulldown", "muscle_group": "back", "description": "Lat isolation"},
    {"name": "Overhead Press", "muscle_group": "shoulders", "description": "Compound shoulder exercise"},
    {"name": "Lateral Raise", "muscle_group": "shoulders", "description": "Side delt isolation"},
    {"name": "Face Pull", "muscle_group": "shoulders", "description": "Rear delt and rotator cuff"},
    {"name": "Barbell Curl", "muscle_group": "biceps", "description": "Bicep compound"},
    {"name": "Dumbbell Curl", "muscle_group": "biceps", "description": "Bicep isolation"},
    {"name": "Hammer Curl", "muscle_group": "biceps", "description": "Brachialis focus"},
    {"name": "Tricep Pushdown", "muscle_group": "triceps", "description": "Tricep isolation"},
    {"name": "Skull Crusher", "muscle_group": "triceps", "description": "Tricep long head"},
    {"name": "Squat", "muscle_group": "legs", "description": "King of leg exercises"},
    {"name": "Romanian Deadlift", "muscle_group": "legs", "description": "Hamstring focus"},
    {"name": "Leg Press", "muscle_group": "legs", "description": "Quad compound"},
    {"name": "Leg Curl", "muscle_group": "legs", "description": "Hamstring isolation"},
    {"name": "Calf Raise", "muscle_group": "legs", "description": "Calf isolation"},
    {"name": "Plank", "muscle_group": "core", "description": "Core stability"},
    {"name": "Cable Crunch", "muscle_group": "core", "description": "Abs isolation"},
    {"name": "Hanging Leg Raise", "muscle_group": "core", "description": "Lower abs focus"},
    {"name": "Deadlift", "muscle_group": "back", "description": "Full posterior chain"},
]

async def seed():
    await init_db()

    async with async_session() as session:
        result = await session.execute(select(User).where(User.id == DEFAULT_USER_ID))
        if not result.scalar_one_or_none():
            user = User(
                id=DEFAULT_USER_ID,
                email="default@example.com",
                name="Default User",
                hashed_password="$2b$12$placeholder_hash_for_default_user",
            )
            session.add(user)
            print("Created default user")

        for ex in exercises_data:
            result = await session.execute(select(Exercise).where(Exercise.name == ex["name"]))
            if not result.scalar_one_or_none():
                session.add(Exercise(
                    id=str(uuid.uuid4()),
                    name=ex["name"],
                    muscle_group=ex["muscle_group"],
                    description=ex["description"],
                ))

        await session.commit()
    print("Database seeded!")

if __name__ == "__main__":
    asyncio.run(seed())
