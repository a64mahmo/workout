import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, Integer, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    meso_cycles = relationship("MesoCycle", back_populates="user")
    sessions = relationship("TrainingSession", back_populates="user")

class Exercise(Base):
    __tablename__ = "exercises"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False, index=True)
    muscle_group = Column(String, nullable=False, index=True)
    description = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    session_exercises = relationship("SessionExercise", back_populates="exercise")

class MesoCycle(Base):
    __tablename__ = "meso_cycles"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    start_date = Column(String)
    end_date = Column(String)
    goal = Column(String)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="meso_cycles")
    micro_cycles = relationship("MicroCycle", back_populates="meso_cycle", cascade="all, delete-orphan")

class MicroCycle(Base):
    __tablename__ = "micro_cycles"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    meso_cycle_id = Column(String, ForeignKey("meso_cycles.id"), nullable=False)
    week_number = Column(Integer, nullable=False)
    focus = Column(String)
    start_date = Column(String)
    end_date = Column(String)
    meso_cycle = relationship("MesoCycle", back_populates="micro_cycles")

class TrainingSession(Base):
    __tablename__ = "training_sessions"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    scheduled_date = Column(String)
    actual_date = Column(String)
    status = Column(String, default="scheduled")
    notes = Column(Text)
    total_volume = Column(Float, default=0)
    user = relationship("User", back_populates="sessions")
    session_exercises = relationship("SessionExercise", back_populates="session", cascade="all, delete-orphan")

class SessionExercise(Base):
    __tablename__ = "session_exercises"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("training_sessions.id"), nullable=False)
    exercise_id = Column(String, ForeignKey("exercises.id"), nullable=False)
    order_index = Column(Integer, default=0)
    notes = Column(Text)
    session = relationship("TrainingSession", back_populates="session_exercises")
    exercise = relationship("Exercise", back_populates="session_exercises")
    sets = relationship("ExerciseSet", back_populates="session_exercise", cascade="all, delete-orphan")

class ExerciseSet(Base):
    __tablename__ = "exercise_sets"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_exercise_id = Column(String, ForeignKey("session_exercises.id"), nullable=False)
    set_number = Column(Integer, nullable=False)
    reps = Column(Integer)
    weight = Column(Float)
    rpe = Column(Float)
    is_warmup = Column(Boolean, default=False)
    is_completed = Column(Boolean, default=False)
    session_exercise = relationship("SessionExercise", back_populates="sets")
