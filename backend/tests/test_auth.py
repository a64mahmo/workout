"""
Tests for /api/auth  (register · login · logout · /me)

Coverage:
  - POST /api/auth/register  — success, duplicate email
  - POST /api/auth/login     — success, wrong password, unknown email, rate limit
  - POST /api/auth/logout    — clears cookie
  - GET  /api/auth/me        — authenticated, unauthenticated
"""

import pytest
import pytest_asyncio
import uuid
from passlib.context import CryptContext

from app.models.models import User
import app.api.auth as auth_api

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ── helpers ──────────────────────────────────────────────────────────────────

def make_register_payload(**overrides):
    return {
        "email": f"user_{uuid.uuid4().hex[:6]}@example.com",
        "name": "Alice",
        "password": "SecurePass1!",
        **overrides,
    }


# ── register ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_register_success(client):
    payload = make_register_payload()
    resp = await client.post("/api/auth/register", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "user_id" in data
    assert data["message"] == "User registered successfully"


@pytest.mark.asyncio
async def test_register_sets_auth_cookie(client):
    payload = make_register_payload()
    resp = await client.post("/api/auth/register", json=payload)
    assert resp.status_code == 200
    assert "access_token" in resp.cookies


@pytest.mark.asyncio
async def test_register_duplicate_email_returns_400(client):
    payload = make_register_payload()
    await client.post("/api/auth/register", json=payload)
    resp = await client.post("/api/auth/register", json=payload)
    assert resp.status_code == 400
    assert "already registered" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_register_invalid_email_returns_422(client):
    resp = await client.post(
        "/api/auth/register",
        json={"email": "not-an-email", "name": "Bob", "password": "pass"},
    )
    assert resp.status_code == 422


# ── login ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_login_success(client, db_session):
    password = "MyPassword1!"
    hashed = pwd_context.hash(password)
    email = f"login_{uuid.uuid4().hex[:6]}@example.com"
    user = User(
        id=str(uuid.uuid4()),
        email=email,
        name="Login User",
        hashed_password=hashed,
    )
    db_session.add(user)
    await db_session.commit()

    resp = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200
    assert resp.json()["message"] == "Login successful"
    assert "access_token" in resp.cookies


@pytest.mark.asyncio
async def test_login_wrong_password_returns_401(client, db_session):
    password = "RealPassword1!"
    hashed = pwd_context.hash(password)
    email = f"wrong_{uuid.uuid4().hex[:6]}@example.com"
    db_session.add(User(
        id=str(uuid.uuid4()), email=email,
        name="User", hashed_password=hashed,
    ))
    await db_session.commit()

    resp = await client.post("/api/auth/login", json={"email": email, "password": "WrongPassword!"})
    assert resp.status_code == 401
    assert "invalid" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_login_unknown_email_returns_401(client):
    resp = await client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "whatever"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_rate_limit(client, db_session):
    """After 5 failed attempts the 6th should be HTTP 429."""
    # Reset the in-memory rate-limit store between tests
    auth_api._login_attempts.clear()

    email = "ratelimit@example.com"
    for _ in range(5):
        await client.post("/api/auth/login", json={"email": email, "password": "bad"})

    resp = await client.post("/api/auth/login", json={"email": email, "password": "bad"})
    assert resp.status_code == 429
    assert "too many" in resp.json()["detail"].lower()

    # Cleanup
    auth_api._login_attempts.clear()


# ── logout ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_logout_returns_200(client):
    resp = await client.post("/api/auth/logout")
    assert resp.status_code == 200
    assert resp.json()["message"] == "Logged out"


@pytest.mark.asyncio
async def test_logout_clears_cookie(client):
    resp = await client.post("/api/auth/logout")
    # The cookie should be cleared (max-age=0 or expired)
    set_cookie = resp.headers.get("set-cookie", "")
    assert "access_token" in set_cookie


# ── /me ───────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_me_returns_current_user(client, test_user, auth_headers):
    resp = await client.get("/api/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == test_user.id
    assert data["email"] == test_user.email
    assert data["name"] == test_user.name
    assert "has_fitbit_connected" in data


@pytest.mark.asyncio
async def test_me_unauthenticated_returns_401(client):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401
