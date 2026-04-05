import pytest
from app.services.progression import ProgressionService, SessionStats

def test_progression_arc_accumulation_start():
    # Week 1 should be accumulation phase with target RPE 7.0
    stats = SessionStats(volume=1000, set_count=3, top_weight=100.0, avg_rpe=7.0, max_rpe=7.0)
    result = ProgressionService.calculate_suggestion(stats, meso_week=1, meso_total_weeks=4)
    
    assert result.meso_phase == "accumulation"
    assert result.target_rpe == 7.0
    assert result.suggested_weight == 100.0 # RPE matches target
    assert result.suggested_sets == 4 # RPE 7.0 < 7.5 in accumulation -> add 1 set

def test_progression_arc_peak_phase():
    # Week 4 should be peak phase with target RPE 9.5
    stats = SessionStats(volume=2000, set_count=5, top_weight=150.0, avg_rpe=8.5, max_rpe=8.5)
    result = ProgressionService.calculate_suggestion(stats, meso_week=4, meso_total_weeks=4)
    
    assert result.meso_phase == "peak"
    assert result.target_rpe == 9.5
    # RPE delta is 1.0 -> +2.5% -> 153.75 -> rounded to 155.0 or 152.5? 
    # 1.0 * 0.025 = 0.025. 150 * 1.025 = 153.75. Round(153.75/2.5)*2.5 = 155.0 or 152.5.
    # Python round(153.75/2.5) = round(61.5) = 62. 62 * 2.5 = 155.0.
    assert result.suggested_weight == 155.0
    assert result.suggested_sets == 5 # RPE 8.5 < 9.0 in peak -> hold sets

def test_progression_arc_deload_trigger_by_week():
    # Week 5 (of 4) should be deload
    stats = SessionStats(volume=2500, set_count=6, top_weight=200.0, avg_rpe=9.5, max_rpe=10.0)
    result = ProgressionService.calculate_suggestion(stats, meso_week=5, meso_total_weeks=4)
    
    assert result.meso_phase == "deload"
    assert result.target_rpe == 5.5
    assert result.suggested_weight == 130.0 # 200 * 0.65
    assert result.suggested_sets == 3 # 6 / 2

def test_progression_arc_deload_trigger_by_rpe():
    # Week 3 but hit RPE 10 -> deload next week
    stats = SessionStats(volume=2000, set_count=4, top_weight=150.0, avg_rpe=9.5, max_rpe=10.0)
    result = ProgressionService.calculate_suggestion(stats, meso_week=3, meso_total_weeks=4)
    
    # In my implementation, just_hit_peak triggers deload regardless of week
    assert result.meso_phase == "deload"
    assert result.suggested_weight == round(round(150 * 0.65 / 2.5) * 2.5, 1)

def test_weight_adjustment_rpe_too_high():
    # Target RPE 7.0, actual 9.0 -> reduce weight
    stats = SessionStats(volume=1000, set_count=3, top_weight=100.0, avg_rpe=9.0, max_rpe=9.0)
    result = ProgressionService.calculate_suggestion(stats, meso_week=1, meso_total_weeks=4)
    
    assert result.suggested_weight < 100.0
    assert "reduce" in result.adjustment_reason

def test_weight_adjustment_no_rpe_logged():
    # No RPE -> default +2.5 lbs
    stats = SessionStats(volume=1000, set_count=3, top_weight=100.0, avg_rpe=None, max_rpe=None)
    result = ProgressionService.calculate_suggestion(stats, meso_week=1, meso_total_weeks=4)
    
    assert result.suggested_weight == 102.5
    assert "no RPE logged" in result.adjustment_reason
