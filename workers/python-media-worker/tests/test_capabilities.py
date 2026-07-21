import pytest

from src.capabilities import get_capabilities, supports_step


def test_default_capabilities(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MEDIA_CAPABILITIES", raising=False)
    caps = get_capabilities()
    assert caps == {"IngestionRequested", "TranscriptionRequested", "RenderVideoRequested", "RenderImageRequested"}


def test_single_capability(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEDIA_CAPABILITIES", "TranscriptionRequested")
    caps = get_capabilities()
    assert caps == {"TranscriptionRequested"}
    assert supports_step("TranscriptionRequested") is True
    assert supports_step("IngestionRequested") is False
    assert supports_step("RenderVideoRequested") is False
    assert supports_step("RenderImageRequested") is False


def test_multiple_capabilities(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEDIA_CAPABILITIES", "IngestionRequested,RenderVideoRequested")
    caps = get_capabilities()
    assert caps == {"IngestionRequested", "RenderVideoRequested"}
    assert supports_step("IngestionRequested") is True
    assert supports_step("TranscriptionRequested") is False
    assert supports_step("RenderVideoRequested") is True
    assert supports_step("RenderImageRequested") is False


def test_empty_capabilities(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEDIA_CAPABILITIES", "")
    caps = get_capabilities()
    assert caps == set()


def test_whitespace_handling(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEDIA_CAPABILITIES", " ingestion , render-video ")
    caps = get_capabilities()
    assert caps == {"ingestion", "render-video"}
