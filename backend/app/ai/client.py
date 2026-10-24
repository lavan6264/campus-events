"""The only module that talks to the Gemini API (Google AI Studio).

`generate_json` returns a validated Pydantic object, or None on any problem: no key,
network error, timeout, bad JSON or a response that fails validation. Callers treat
None as "use the deterministic fallback".

The 5 second limit is enforced here, not by the SDK: the API refuses a server side
deadline under 10 seconds, and a stalled connection ignores the HTTP timeout. The call
runs in a worker thread and we stop waiting after TIMEOUT_SECONDS. The SDK's own
10 second timeout then ends the abandoned call. At most MAX_IN_FLIGHT calls run at
once, so a stalled API cannot pile up threads: extra requests go straight to the fallback.
"""
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from typing import TypeVar

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.config import get_settings

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 5
SDK_TIMEOUT_MS = 10_000  # the API's minimum allowed deadline
MAX_IN_FLIGHT = 4

T = TypeVar("T", bound=BaseModel)

_executor = ThreadPoolExecutor(max_workers=MAX_IN_FLIGHT, thread_name_prefix="gemini")
_slots = threading.BoundedSemaphore(MAX_IN_FLIGHT)


@lru_cache
def _client_for(api_key: str) -> genai.Client:
    return genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=SDK_TIMEOUT_MS))


def get_client() -> genai.Client | None:
    key = get_settings().gemini_api_key.strip()
    return _client_for(key) if key else None


def generate_json(prompt: str, schema: type[T], system: str | None = None) -> T | None:
    client = get_client()
    if client is None:
        return None
    if not _slots.acquire(blocking=False):
        logger.warning("AI busy, using fallback")
        return None

    model = get_settings().gemini_model
    config = types.GenerateContentConfig(
        system_instruction=system,
        response_mime_type="application/json",
        response_schema=schema,
        temperature=0.2,
    )

    def call():
        try:
            return client.models.generate_content(model=model, contents=prompt, config=config)
        finally:
            _slots.release()

    try:
        response = _executor.submit(call).result(timeout=TIMEOUT_SECONDS)
        return schema.model_validate_json(response.text)
    except Exception as exc:  # timeout, network, quota, bad JSON, validation
        logger.warning("AI call failed, using fallback: %s", type(exc).__name__)
        return None
