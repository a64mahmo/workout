from pydantic import BaseModel
from typing import Optional, List

class ExerciseResponse(BaseModel):
    id: str
    name: str
    muscle_group: str
    description: Optional[str] = None
    class Config:
        from_attributes = True

class SessionExerciseResponse(BaseModel):
    id: str
    exercise_id: str
    order_index: int
    notes: Optional[str] = None
    sets: List = []
    class Config:
        from_attributes = True

class SessionResponse(BaseModel):
    id: str
    user_id: str
    name: str
    scheduled_date: Optional[str] = None
    actual_date: Optional[str] = None
    status: str
    notes: Optional[str] = None
    total_volume: Optional[float] = 0
    session_exercises: List[SessionExerciseResponse] = []
    class Config:
        from_attributes = True
