import pytest

from src.capabilities import get_capabilities, supports_step


def test_default_capabilities(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MEDIA_CAPABILITIES", raising=False)
    caps = get_capabilities()
    assert caps == {"ingestion", "transcription", "render-video", "render-image"}


def test_single_capability(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEDIA_CAPABILITIES", "transcription")
    caps = get_capabilities()
    assert caps == {"transcription"}
    assert supports_step("transcription") is True
    assert supports_step("ingestion") is False
    assert supports_step("render-video") is False
    assert supports_step("render-image") is False


def test_multiple_capabilities(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEDIA_CAPABILITIES", "ingestion,render-video")
    caps = get_capabilities()
    assert caps == {"ingestion", "render-video"}
    assert supports_step("ingestion") is True
    assert supports_step("transcription") is False
    assert supports_step("render-video") is True
    assert supports_step("render-image") is False


def test_empty_capabilities(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEDIA_CAPABILITIES", "")
    caps = get_capabilities()
    assert caps == set()


def test_whitespace_handling(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEDIA_CAPABILITIES", " ingestion , render-video ")
    caps = get_capabilities()
    assert caps == {"ingestion", "render-video"}
