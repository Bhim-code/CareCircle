"""Sending email. With no SMTP_HOST set, emails are written to the log (demo mode).

Callers must keep health information out of subjects and bodies: say "a reminder
was not confirmed", never the medicine's name.
"""

import logging
import smtplib
from email.message import EmailMessage

from app.core.config import get_settings

logger = logging.getLogger("carecircle.mail")

# Tests read this to see what would have been sent.
outbox: list[EmailMessage] = []


def send_email(to: str, subject: str, body: str) -> bool:
    settings = get_settings()
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    if not settings.smtp_host:
        outbox.append(message)
        if settings.environment == "development":
            # Only in development: shows reset links so you can test without a mail server.
            logger.info("Email (not sent, no SMTP_HOST) to=%s subject=%r\n%s", to, subject, body)
        else:
            logger.info("Email (not sent, no SMTP_HOST) subject=%r", subject)
        return True

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_starttls:
                smtp.starttls()
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
        return True
    except (OSError, smtplib.SMTPException) as exc:
        logger.error("Email failed: %s", type(exc).__name__)
        return False
