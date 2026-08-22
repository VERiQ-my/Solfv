from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    solana_network: str = "devnet"
    solana_rpc_url: str = "https://api.devnet.solana.com"
    solana_commitment: str = "confirmed"
    usdc_mint: str = DEVNET_USDC_MINT
    usdc_decimals: int = 6
    payment_mode: str = "simulated"
    payment_recipient: str = "GG8RDLrDoBfvdqZuJrRT2xFsVAE7R2MKsGzCrpMHSzwP"
    payment_amount_base_units: int = Field(default=1_000, gt=0)
    payment_timeout_seconds: int = Field(default=300, gt=0, le=900)
    database_url: str = ""
    payment_db_path: str = "./data/solfv-simulated.sqlite3"
    coingecko_demo_api_key: str = ""

    @field_validator("payment_mode")
    @classmethod
    def require_supported_payment_mode(cls, value: str) -> str:
        if value not in {"simulated", "devnet"}:
            raise ValueError("PAYMENT_MODE must be simulated or devnet")
        return value

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        if isinstance(value, str) and value.startswith("DATABASE_URL="):
            return value.removeprefix("DATABASE_URL=")
        return value

    @field_validator("solana_network")
    @classmethod
    def require_devnet(cls, value: str) -> str:
        if value.lower() != "devnet":
            raise ValueError("Solfv payment gateway supports Solana devnet only")
        return "devnet"

    @field_validator("solana_rpc_url")
    @classmethod
    def reject_mainnet_rpc(cls, value: str) -> str:
        if "mainnet" in value.lower():
            raise ValueError("Mainnet RPC URLs are forbidden")
        return value

    @field_validator("usdc_mint")
    @classmethod
    def require_devnet_usdc(cls, value: str) -> str:
        if value != DEVNET_USDC_MINT:
            raise ValueError("Only Circle Solana devnet USDC is supported")
        return value

    @field_validator("usdc_decimals")
    @classmethod
    def require_usdc_decimals(cls, value: int) -> int:
        if value != 6:
            raise ValueError("Solana devnet USDC must use 6 decimals")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
