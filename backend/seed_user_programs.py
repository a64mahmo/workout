"""
Seed default programs for users.

Usage:
  # Seed a specific user by email
  python seed_user_programs.py --email user@example.com

  # Seed a specific user by ID
  python seed_user_programs.py --user-id <uuid>

  # Seed ALL users in the database
  python seed_user_programs.py --all
"""
import asyncio
import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from sqlalchemy import select

from app.database import async_session, init_db
from app.models.models import User
from app.services.program_seed import seed_programs_for_user, PLAN_NAME


async def seed_one(user_id: str, email: str) -> None:
    async with async_session() as db:
        await seed_programs_for_user(user_id, db)
    print(f"Seeded programs for {email} ({user_id})")


async def run(args: argparse.Namespace) -> None:
    await init_db()

    if args.all:
        async with async_session() as db:
            result = await db.execute(select(User))
            users = result.scalars().all()

        if not users:
            print("No users found in the database.")
            return

        print(f"Seeding {len(users)} user(s)...")
        for user in users:
            # Check if already has the plan (seed_programs_for_user is idempotent,
            # but this gives nicer output)
            async with async_session() as db:
                from sqlalchemy import select as _select
                from app.models.models import Plan
                existing = await db.execute(
                    _select(Plan).where(Plan.name == PLAN_NAME, Plan.user_id == user.id)
                )
                if existing.scalar_one_or_none():
                    print(f"  Skipping {user.email} — plan already exists")
                    continue
            await seed_one(user.id, user.email)

        print("Done.")
        return

    # Single user by email or ID
    async with async_session() as db:
        if args.email:
            result = await db.execute(select(User).where(User.email == args.email))
        else:
            result = await db.execute(select(User).where(User.id == args.user_id))

        user = result.scalar_one_or_none()

    if not user:
        identifier = args.email or args.user_id
        print(f"Error: No user found for '{identifier}'")
        sys.exit(1)

    await seed_one(user.id, user.email)
    print("Done.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed default programs for users")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--email", help="Seed programs for the user with this email")
    group.add_argument("--user-id", help="Seed programs for the user with this ID")
    group.add_argument("--all", action="store_true", help="Seed programs for ALL users")
    args = parser.parse_args()

    asyncio.run(run(args))


if __name__ == "__main__":
    main()
