import pytest
from src.subtitle_utils import segments_to_srt, segments_to_vtt, format_timestamp, recalc_timecodes


def test_empty_segments_srt():
    srt = segments_to_srt([])
    assert srt == ""


def test_single_segment_srt():
    segments = [{"start": 0.0, "end": 3.0, "text": "Hello"}]
    srt = segments_to_srt(segments)
    assert "1\n" in srt
    assert "00:00:00,000 --> 00:00:03,000" in srt


def test_recalc_timecodes_empty():
    result = recalc_timecodes([], 10.0)
    assert result == []


def test_recalc_timecodes_all_before_clip():
    segments = [
        {"start": 0.0, "end": 5.0, "text": "A"},
        {"start": 5.0, "end": 10.0, "text": "B"},
    ]
    result = recalc_timecodes(segments, 10.0)
    assert result == []


def test_format_timestamp_edge_cases():
    assert format_timestamp(1.0) == "00:00:01,000"
    assert format_timestamp(60.0) == "00:01:00,000"
    assert format_timestamp(3600.0) == "01:00:00,000"
