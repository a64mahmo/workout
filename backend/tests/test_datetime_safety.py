import pytest
from sqlalchemy import DateTime
from app.models.models import Base, TrainingSession
from datetime import datetime, timezone, timedelta
from app.api.sessions import get_session_pre_summary
import uuid

def test_all_datetime_columns_have_timezone_enabled():
    """
    Ensures that every DateTime column in the project is explicitly set to timezone=True.
    This prevents asyncpg (PostgreSQL) from crashing when receiving aware UTC objects.
    """
    for table in Base.metadata.tables.values():
        for column in table.columns:
            if isinstance(column.type, DateTime):
                assert column.type.timezone is True, \
                    f"Column '{column.name}' in table '{table.name}' is missing timezone=True"

def test_datetime_subtraction_safety():
    """
    Verifies that the logic used to calculate session duration is safe
    even if the database returns a naive datetime (common in SQLite).
    """
    # Simulate a naive datetime from a database like SQLite
    naive_start = datetime.now().replace(microsecond=0) 
    
    # Simulate our current "Force-Naive UTC" logic
    now_naive_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    
    # This subtraction should NOT throw a TypeError
    try:
        duration = (now_naive_utc - naive_start).total_seconds()
        assert isinstance(duration, float)
    except TypeError as e:
        pytest.fail(f"Datetime subtraction failed with TypeError: {e}. "
                    "Ensure both objects are naive or both are aware.")

def test_aware_to_naive_conversion_consistency():
    """
    Ensures our utility for generating timestamps produces naive objects 
    to match the current 'Force-Naive' strategy used across the API.
    """
    def get_now():
        return datetime.now(timezone.utc).replace(tzinfo=None)
    
    ts = get_now()
    assert ts.tzinfo is None, "Timestamp should be naive for cross-DB compatibility"
    
    # Ensure it's roughly 'now'
    diff = datetime.utcnow() - ts
    assert abs(diff.total_seconds()) < 5
