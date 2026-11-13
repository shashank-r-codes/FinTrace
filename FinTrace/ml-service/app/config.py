import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql://fintrace:fintrace_dev_pass@localhost:5432/fintrace_db",
    )
    ml_artifacts_dir: str = os.getenv("ML_ARTIFACTS_DIR", "/app/artifacts")
    log_level: str = os.getenv("LOG_LEVEL", "info")

    class Config:
        extra = "ignore"


settings = Settings()
