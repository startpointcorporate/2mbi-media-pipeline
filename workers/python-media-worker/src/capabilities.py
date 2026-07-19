def get_capabilities() -> set[str]:
    from src.config import Settings
    cfg = Settings()
    parts = cfg.media_capabilities.split(",")
    return {p.strip() for p in parts if p.strip()}


def supports_step(step: str) -> bool:
    return step in get_capabilities()
