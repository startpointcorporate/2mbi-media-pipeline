import pytest
from src.subtitle_utils import format_timestamp, format_vtt_timestamp, segments_to_srt, segments_to_vtt, recalc_timecodes


def test_format_timestamp():
    assert format_timestamp(0.0) == "00:00:00,000"
    assert format_timestamp(65.5) == "00:01:05,500"
    assert format_timestamp(3661.123) == "01:01:01,123"


def test_format_vtt_timestamp():
    assert format_vtt_timestamp(0.0) == "00:00:00.000"
    assert format_vtt_timestamp(65.5) == "00:01:05.500"


def test_segments_to_srt():
    segments = [
        {"start": 0.0, "end": 4.2, "text": "Bonjour"},
        {"start": 4.2, "end": 8.5, "text": "le monde"},
    ]
    srt = segments_to_srt(segments)
    assert "1" in srt
    assert "00:00:00,000 --> 00:00:04,200" in srt
    assert "Bonjour" in srt
    assert "2" in srt
    assert "00:00:04,200 --> 00:00:08,500" in srt
    assert "le monde" in srt


def test_segments_to_vtt():
    segments = [
        {"start": 0.0, "end": 2.0, "text": "Test"},
    ]
    vtt = segments_to_vtt(segments)
    assert vtt.startswith("WEBVTT\n")
    assert "00:00:00.000 --> 00:00:02.000" in vtt
    assert "Test" in vtt


def test_recalc_timecodes():
    segments = [
        {"start": 30.0, "end": 35.0, "text": "Before clip"},
        {"start": 40.0, "end": 45.0, "text": "In clip"},
        {"start": 50.0, "end": 55.0, "text": "Also in clip"},
        {"start": 60.0, "end": 65.0, "text": "After clip"},
    ]
    result = recalc_timecodes(segments, 35.0, clip_end=55.0)
    assert len(result) == 2
    assert result[0]["start"] == 5.0
    assert result[0]["end"] == 10.0
    assert result[1]["start"] == 15.0
    assert result[1]["end"] == 20.0


def test_recalc_timecodes_partial_overlap():
    segments = [
        {"start": 35.0, "end": 40.0, "text": "Partial"},
    ]
    result = recalc_timecodes(segments, 35.0, clip_end=40.0)
    assert len(result) == 1
    assert result[0]["start"] == 0.0
    assert result[0]["end"] == 5.0
