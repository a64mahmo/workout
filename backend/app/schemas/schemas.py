from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime

class UserCreate(BaseModel):
    email: EmailStr
    name: str
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    user_id: str
    message: str

class ExerciseCreate(BaseModel):
    name: str
    muscle_group: str
    description: Optional[str] = None

class ExerciseUpdate(BaseModel):
    name: Optional[str] = None
    muscle_group: Optional[str] = None
    description: Optional[str] = None

class ExerciseResponse(BaseModel):
    id: str
    name: str
    muscle_group: str
    description: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class MesoCycleCreate(BaseModel):
    name: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    goal: Optional[str] = None
    is_active: bool = True

class MesoCycleUpdate(BaseModel):
    name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    goal: Optional[str] = None
    is_active: Optional[bool] = None

class MesoCycleResponse(BaseModel):
    id: str
    user_id: str
    name: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    goal: Optional[str] = None
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class MicroCycleCreate(BaseModel):
    week_number: int
    focus: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None

class MicroCycleUpdate(BaseModel):
    week_number: Optional[int] = None
    focus: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None

class MicroCycleResponse(BaseModel):
    id: str
    meso_cycle_id: str
    week_number: int
    focus: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None

    class Config:
        from_attributes = True

class SessionCreate(BaseModel):
    name: str
    meso_cycle_id: Optional[str] = None
    micro_cycle_id: Optional[str] = None
    scheduled_date: Optional[str] = None
    status: str = "scheduled"
    notes: Optional[str] = None

class SessionUpdate(BaseModel):
    name: Optional[str] = None
    scheduled_date: Optional[str] = None
    actual_date: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None

class ExerciseSetResponse(BaseModel):
    id: str
    set_number: int
    reps: Optional[int] = None
    weight: Optional[float] = None
    rpe: Optional[float] = None
    is_warmup: bool
    is_completed: bool

    class Config:
        from_attributes = True

class SessionExerciseResponse(BaseModel):
    id: str
    exercise_id: str
    order_index: int
    notes: Optional[str] = None
    sets: List[ExerciseSetResponse] = []
    exercise_name: Optional[str] = None

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
    total_volume: float
    session_exercises: List[SessionExerciseResponse] = []

    class Config:
        from_attributes = True

class SessionExerciseCreate(BaseModel):
    exercise_id: str
    order_index: int = 0
    notes: Optional[str] = None

class SessionExerciseUpdate(BaseModel):
    order_index: Optional[int] = None
    notes: Optional[str] = None

class ExerciseSetCreate(BaseModel):
    set_number: int
    reps: Optional[int] = None
    weight: Optional[float] = None
    rpe: Optional[float] = None
    is_warmup: bool = False

class ExerciseSetUpdate(BaseModel):
    reps: Optional[int] = None
    weight: Optional[float] = None
    rpe: Optional[float] = None
    is_warmup: Optional[bool] = None
    is_completed: Optional[bool] = None
