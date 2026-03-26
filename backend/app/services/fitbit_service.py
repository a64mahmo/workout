import httpx
import base64
import os
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from urllib.parse import urlencode
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from dotenv import load_dotenv
from app.models.models import User, HealthMetric, TrainingSession
from app.schemas.schemas import HealthMetricBase

load_dotenv()

FITBIT_CLIENT_ID = os.getenv("FITBIT_CLIENT_ID")
FITBIT_CLIENT_SECRET = os.getenv("FITBIT_CLIENT_SECRET")
FITBIT_REDIRECT_URI = os.getenv("FITBIT_REDIRECT_URI", "http://localhost:3000/settings/fitbit/callback")

class FitbitService:
    def __init__(self):
        self.base_url = "https://api.fitbit.com"
        self.token_url = f"{self.base_url}/oauth2/token"
        self.auth_url = "https://www.fitbit.com/oauth2/authorize"

    def get_auth_url(self, state: str) -> str:
        params = {
            "response_type": "code",
            "client_id": FITBIT_CLIENT_ID,
            "redirect_uri": FITBIT_REDIRECT_URI,
            "scope": "activity heartrate profile sleep weight",
            "state": state
        }
        return f"{self.auth_url}?{urlencode(params)}"

    async def exchange_code(self, code: str, db: AsyncSession, user: User) -> Dict[str, Any]:
        auth_header = base64.b64encode(f"{FITBIT_CLIENT_ID}:{FITBIT_CLIENT_SECRET}".encode()).decode()
        headers = {
            "Authorization": f"Basic {auth_header}",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        data = {
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": FITBIT_REDIRECT_URI,
            "client_id": FITBIT_CLIENT_ID
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(self.token_url, headers=headers, data=data)
            response.raise_for_status()
            token_data = response.json()

            user.fitbit_access_token = token_data["access_token"]
            user.fitbit_refresh_token = token_data["refresh_token"]
            user.fitbit_user_id = token_data["user_id"]
            user.fitbit_token_expires_at = datetime.utcnow() + timedelta(seconds=token_data["expires_in"])
            
            await db.commit()
            return token_data

    async def _refresh_token(self, db: AsyncSession, user: User) -> str:
        if user.fitbit_token_expires_at and user.fitbit_token_expires_at > datetime.utcnow() + timedelta(minutes=5):
            return user.fitbit_access_token

        auth_header = base64.b64encode(f"{FITBIT_CLIENT_ID}:{FITBIT_CLIENT_SECRET}".encode()).decode()
        headers = {
            "Authorization": f"Basic {auth_header}",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        data = {
            "grant_type": "refresh_token",
            "refresh_token": user.fitbit_refresh_token
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(self.token_url, headers=headers, data=data)
            response.raise_for_status()
            token_data = response.json()

            new_access_token = token_data["access_token"]
            user.fitbit_access_token = new_access_token
            user.fitbit_refresh_token = token_data["refresh_token"]
            user.fitbit_token_expires_at = datetime.utcnow() + timedelta(seconds=token_data["expires_in"])

            await db.commit()
            # Save token to local var before commit expires the ORM instance
            return new_access_token

    async def get_heart_rate(self, db: AsyncSession, user: User, date_str: str) -> Dict[str, Any]:
        token = await self._refresh_token(db, user)
        
        url = f"{self.base_url}/1/user/-/activities/heart/date/{date_str}/1d.json"
        headers = {"Authorization": f"Bearer {token}"}
        
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            return response.json()

    async def get_sleep_data(self, db: AsyncSession, user: User, date: str) -> Dict[str, Any]:
        token = await self._refresh_token(db, user)
        url = f"{self.base_url}/1.2/user/-/sleep/date/{date}.json"
        headers = {"Authorization": f"Bearer {token}"}

        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            return response.json()

    async def get_body_weight(self, db: AsyncSession, user: User, date: str) -> Dict[str, Any]:
        token = await self._refresh_token(db, user)
        url = f"{self.base_url}/1/user/-/body/log/weight/date/{date}.json"
        headers = {"Authorization": f"Bearer {token}"}

        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            return response.json()

    async def get_steps(self, db: AsyncSession, user: User, date: str) -> Dict[str, Any]:
        token = await self._refresh_token(db, user)
        url = f"{self.base_url}/1/user/-/activities/steps/date/{date}/1d.json"
        headers = {"Authorization": f"Bearer {token}"}

        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            return response.json()

    async def _fitbit_get(self, token: str, url: str) -> Dict[str, Any]:
        """Raw authenticated GET — raises on HTTP error."""
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers={"Authorization": f"Bearer {token}"})
            response.raise_for_status()
            return response.json()

    async def get_today_stats(self, db: AsyncSession, user: User) -> Dict[str, Any]:
        # Refresh token once upfront; if it fails the connection is broken
        try:
            token = await self._refresh_token(db, user)
        except Exception as e:
            print(f"Fitbit token refresh failed: {e}")
            return {"connected": False}

        stats: Dict[str, Any] = {
            "connected": True,
            "steps": None,
            "resting_hr": None,
            "weight_kg": None,
            "body_fat_pct": None,
            "sleep_duration_seconds": None,
            "sleep_score": None,
            "sleep_efficiency": None,
        }

        today = datetime.utcnow().strftime("%Y-%m-%d")

        # Steps
        try:
            data = await self._fitbit_get(
                token, f"{self.base_url}/1/user/-/activities/steps/date/{today}/1d.json"
            )
            activities = data.get("activities-steps", [])
            if activities:
                stats["steps"] = int(activities[0].get("value", 0))
        except Exception as e:
            print(f"Fitbit steps error: {e}")

        # Resting heart rate
        try:
            data = await self._fitbit_get(
                token, f"{self.base_url}/1/user/-/activities/heart/date/{today}/1d.json"
            )
            activities = data.get("activities-heart", [])
            if activities:
                stats["resting_hr"] = activities[0].get("value", {}).get("restingHeartRate")
        except Exception as e:
            print(f"Fitbit HR error: {e}")

        # Weight — look back up to 7 days since users don't log daily
        try:
            data = await self._fitbit_get(
                token, f"{self.base_url}/1/user/-/body/log/weight/date/{today}/7d.json"
            )
            entries = data.get("weight", [])
            if entries:
                latest = entries[-1]
                stats["weight_kg"] = latest.get("weight")
                stats["body_fat_pct"] = latest.get("fat")
        except Exception as e:
            print(f"Fitbit weight error: {e}")

        # Sleep
        try:
            data = await self._fitbit_get(
                token, f"{self.base_url}/1.2/user/-/sleep/date/{today}.json"
            )
            sleeps = data.get("sleep", [])
            if sleeps:
                main = next((s for s in sleeps if s.get("isMainSleep")), sleeps[0])
                stats["sleep_duration_seconds"] = main.get("duration", 0) // 1000
                stats["sleep_efficiency"] = main.get("efficiency")
                stats["sleep_score"] = main.get("efficiency")
        except Exception as e:
            print(f"Fitbit sleep error: {e}")

        return stats

    async def sync_session_metrics(self, db: AsyncSession, session: TrainingSession, user: User):
        if not user.fitbit_access_token:
            return

        date_str = session.actual_date or session.scheduled_date
        if not date_str:
            return

        # Heart Rate (daily summary — resting HR + zone minutes)
        try:
            hr_data = await self.get_heart_rate(db, user, date_str)
            activities_heart = hr_data.get("activities-heart", [])
            if activities_heart:
                value = activities_heart[0].get("value", {})
                resting_hr = value.get("restingHeartRate")
                if resting_hr:
                    session.average_hr = resting_hr
                zones = value.get("heartRateZones", [])
                for zone in zones:
                    if zone.get("name") == "Peak" and zone.get("max"):
                        session.max_hr = zone["max"]
                        break
        except Exception as e:
            print(f"Error fetching heart rate: {e}")

        # Sync Sleep and Weight
        try:
            stmt = select(HealthMetric).where(HealthMetric.user_id == user.id, HealthMetric.date == date_str)
            result = await db.execute(stmt)
            metric = result.scalars().first()

            if not metric:
                metric = HealthMetric(user_id=user.id, date=date_str, session_id=session.id)
                db.add(metric)
            else:
                metric.session_id = session.id

            # Fetch Sleep
            try:
                sleep_resp = await self.get_sleep_data(db, user, date_str)
                if sleep_resp.get("sleep"):
                    main_sleep = next((s for s in sleep_resp["sleep"] if s.get("isMainSleep")), sleep_resp["sleep"][0])
                    metric.sleep_duration_seconds = main_sleep.get("duration", 0) // 1000
                    metric.sleep_efficiency = main_sleep.get("efficiency")
            except Exception as e:
                print(f"Error fetching sleep: {e}")

            # Fetch Weight
            try:
                weight_resp = await self.get_body_weight(db, user, date_str)
                if weight_resp.get("weight"):
                    latest_weight = weight_resp["weight"][-1]
                    metric.weight_kg = latest_weight.get("weight")
                    metric.body_fat_pct = latest_weight.get("fat")
                    metric.bmi = latest_weight.get("bmi")
            except Exception as e:
                print(f"Error fetching weight: {e}")

            await db.commit()
        except Exception as e:
            print(f"Error syncing health metrics: {e}")
