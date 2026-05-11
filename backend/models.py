"""Pydantic models for Wayly mobile."""
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from typing import List, Optional, Literal
from datetime import datetime, timezone
import uuid


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


# ---------- Auth ----------
class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str
    role: Literal["caregiver", "participant"] = "caregiver"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    email: EmailStr
    name: str
    role: Literal["caregiver", "participant"]
    plan: str = "free"
    household_id: Optional[str] = None
    created_at: str
    is_admin: bool = False
    subscription_status: Optional[str] = None
    trial_ends_at: Optional[str] = None


class TokenResponse(BaseModel):
    token: str
    user: UserPublic


# ---------- Household ----------
class HouseholdCreate(BaseModel):
    participant_name: str
    classification: int = Field(ge=1, le=8, default=4)
    provider_name: str = "Your provider"
    is_grandfathered: bool = False


class Household(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    owner_id: str
    participant_name: str
    classification: int
    provider_name: str
    is_grandfathered: bool = False
    created_at: str = Field(default_factory=now_iso)


# ---------- Statements ----------
class StatementLineItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    date: str
    service_code: Optional[str] = None
    service_name: str
    stream: Literal["Clinical", "Independence", "Everyday Living"]
    units: float = 1.0
    unit_price: float = 0.0
    total: float = 0.0
    contribution_paid: float = 0.0
    government_paid: float = 0.0


class Anomaly(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    severity: Literal["info", "warning", "alert"] = "info"
    title: str
    detail: str
    suggested_action: Optional[str] = None
    line_item_id: Optional[str] = None


class Statement(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    household_id: str
    filename: str
    period_label: Optional[str] = None
    uploaded_at: str = Field(default_factory=now_iso)
    line_items: List[StatementLineItem] = Field(default_factory=list)
    summary: Optional[str] = None
    anomalies: List[Anomaly] = Field(default_factory=list)
    raw_text_preview: Optional[str] = None
    has_original_file: bool = False


# ---------- Notifications ----------
class NotificationItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=new_id)
    user_id: str
    title: str
    body: str
    category: str = "anomaly"
    severity: Literal["info", "warning", "alert"] = "info"
    related_statement_id: Optional[str] = None
    read: bool = False
    created_at: str = Field(default_factory=now_iso)


class PushTokenRegister(BaseModel):
    expo_push_token: str
    platform: Literal["ios", "android", "web"] = "ios"
