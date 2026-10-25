"""How alerts leave the system: email, phone call, push.

For the demo (and by default), calls and pushes are written to the log, and
emails too unless SMTP_HOST is set. Messages never contain health information:
no medicine names, just "a scheduled dose".
"""

import json
import logging
import urllib.error
import urllib.request

from app.core.config import get_settings
from app.services.mailer import send_email

logger = logging.getLogger("carecircle.notify")

# Tests read these to see what would have been sent.
calls_made: list[str] = []
pushes_sent: list[dict] = []

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def email(to: str, subject: str, body: str) -> bool:
    return send_email(to, subject, body)


def phone_call(recipient_id: str, message: str) -> bool:
    """Demo: no real call service is wired up yet; the call is logged.

    To add one (e.g. Twilio), place the call here and return whether it was accepted.
    """
    calls_made.append(message)
    logger.info("Phone call (demo, not placed) for user %s", recipient_id)
    return True


def push(tokens: list[str], title: str, body: str) -> list[str]:
    """Send one notification to each token. Returns tokens the service says are dead."""
    if not tokens:
        return []
    messages = [{"to": t, "title": title, "body": body, "sound": "default"} for t in tokens]
    if get_settings().push_provider == "log":
        pushes_sent.extend(messages)
        logger.info("Push (demo, not sent) to %d device(s): %s", len(tokens), title)
        return []
    request = urllib.request.Request(EXPO_PUSH_URL, data=json.dumps(messages).encode(),
                                     headers={"Content-Type": "application/json",
                                              "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            results = json.load(response).get("data", [])
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        logger.error("Push failed: %s", type(exc).__name__)
        raise
    return [token for token, result in zip(tokens, results, strict=False)
            if result.get("details", {}).get("error") == "DeviceNotRegistered"]
