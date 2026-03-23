from fastapi import APIRouter

router = APIRouter(prefix="/api/plans", tags=["plans"])

@router.get("/templates")
async def get_templates():
    return {
        "templates": [
            {"id": "ppl", "name": "Push/Pull/Legs", "description": "6-day split"},
            {"id": "upper-lower", "name": "Upper/Lower", "description": "4-day split"},
            {"id": "full-body", "name": "Full Body", "description": "3-day split"}
        ]
    }

@router.get("/templates/{template_id}")
async def get_template(template_id: str):
    templates = {
        "ppl": {
            "name": "Push/Pull/Legs",
            "days": [
                {"day": 1, "name": "Push", "muscle_groups": ["chest", "shoulders", "triceps"]},
                {"day": 2, "name": "Pull", "muscle_groups": ["back", "biceps"]},
                {"day": 3, "name": "Legs", "muscle_groups": ["legs", "core"]},
            ]
        },
        "upper-lower": {
            "name": "Upper/Lower",
            "days": [
                {"day": 1, "name": "Upper", "muscle_groups": ["chest", "back", "shoulders", "biceps", "triceps"]},
                {"day": 2, "name": "Lower", "muscle_groups": ["legs", "core"]},
            ]
        },
        "full-body": {
            "name": "Full Body",
            "days": [
                {"day": 1, "name": "Full Body A", "muscle_groups": ["chest", "back", "legs"]},
                {"day": 2, "name": "Full Body B", "muscle_groups": ["shoulders", "biceps", "triceps", "core"]},
            ]
        }
    }
    return templates.get(template_id, {"error": "Template not found"})
