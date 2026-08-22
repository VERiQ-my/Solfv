'''Server-side authentication for the engine API.'''

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass

from fastapi import Header, HTTPException

ENVIRONMENT = (os.getenv('SOLFV_ENVIRONMENT') or 'development').strip().lower()
# Local showcases open directly into the product. Production defaults to the
# same private guest-session gate as the Vite frontend unless an explicit
# authentication mode is configured.
MODE = (os.getenv('SOLFV_AUTH_MODE') or (
    'anonymous' if ENVIRONMENT != 'production' else 'guest'
)).strip().lower()
SUPABASE_URL = (os.getenv('SUPABASE_URL') or os.getenv('VITE_SUPABASE_URL') or '').strip().rstrip('/')
SUPABASE_KEY = (os.getenv('SUPABASE_ANON_KEY') or os.getenv('VITE_SUPABASE_ANON_KEY') or '').strip()
TIMEOUT = int(os.getenv('SUPABASE_TIMEOUT', '10'))
LOCAL_ID = re.compile(r'^user-[0-9a-f]{16}$')


@dataclass(frozen=True)
class Principal:
    id: str
    email: str | None = None
    mode: str = 'supabase'


def status() -> dict:
    return {
        'mode': MODE,
        'configured': MODE in {'anonymous', 'guest', 'local'} or bool(SUPABASE_URL and SUPABASE_KEY),
    }


def _denied(message: str, status_code: int = 401) -> HTTPException:
    return HTTPException(status_code=status_code, detail=message)


def _supabase_user(token: str) -> Principal:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise _denied('Supabase authentication is not configured on the engine.', 503)
    request = urllib.request.Request(
        f'{SUPABASE_URL}/auth/v1/user',
        headers={'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {token}'},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            body = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise _denied('Your session is invalid or has expired. Please log in again.') from error
        raise _denied('Supabase authentication is unavailable.', 503) from error
    except Exception as error:
        raise _denied('Supabase authentication is unavailable.', 503) from error
    user_id = body.get('id')
    if not isinstance(user_id, str) or not user_id:
        raise _denied('Supabase returned an invalid user session.', 503)
    email = body.get('email')
    return Principal(id=user_id, email=email if isinstance(email, str) else None)


def require_user(
    authorization: str | None = Header(default=None),
    x_solfv_dev_user: str | None = Header(default=None),
    x_solfv_guest_user: str | None = Header(default=None),
) -> Principal:
    '''FastAPI dependency used by every user-facing engine endpoint.'''
    if MODE in {'anonymous', 'none', 'disabled'}:
        if ENVIRONMENT == 'production':
            raise _denied('Anonymous authentication is disabled in production.', 503)
        return Principal(
            id=os.getenv('SOLFV_ANONYMOUS_USER_ID', 'demo-user'),
            mode='anonymous',
        )
    if MODE == 'guest':
        try:
            guest_id = str(uuid.UUID(x_solfv_guest_user or ''))
        except ValueError:
            raise _denied('A private browser session is required.')
        return Principal(id=guest_id, mode='guest')
    if MODE == 'local':
        if ENVIRONMENT == 'production':
            raise _denied('Local authentication is disabled in production.', 503)
        if not x_solfv_dev_user or not LOCAL_ID.fullmatch(x_solfv_dev_user):
            raise _denied('A local development account is required.')
        return Principal(id=x_solfv_dev_user, mode='local')
    if MODE != 'supabase':
        raise _denied('SOLFV_AUTH_MODE must be guest, supabase, anonymous, or development-only local.', 503)
    scheme, _, token = (authorization or '').partition(' ')
    if scheme.lower() != 'bearer' or not token:
        raise _denied('Log in to use the SOLFV engine.')
    return _supabase_user(token)
