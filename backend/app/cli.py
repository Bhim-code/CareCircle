"""Admin commands run on the server. Admin and supervisor accounts are made only here.

    python -m app.cli create-staff --role supervisor --email sue@example.com --name "Sue"
    python -m app.cli set-active --email someone@example.com --inactive

The password is asked for on screen, so it never lands in shell history.
"""

import argparse
import getpass
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.models import STAFF_ROLES, User, UserPreferences
from app.db.session import get_engine
from app.services.auth import end_all_sessions


def create_staff(email: str, name: str, role: str, password: str | None = None) -> User:
    if role not in STAFF_ROLES:
        raise SystemExit(f"Role must be one of {STAFF_ROLES}")
    password = password or getpass.getpass("Password (8+ characters): ")
    if len(password) < 8:
        raise SystemExit("Password must be at least 8 characters.")
    with Session(get_engine(), expire_on_commit=False) as db:
        if db.scalar(select(User).where(User.email == email.lower())):
            raise SystemExit("An account with this email already exists.")
        user = User(email=email.lower(), name=name, role=role, password_hash=hash_password(password))
        db.add(user)
        db.flush()
        db.add(UserPreferences(user_id=user.id))
        db.commit()
        return user


def set_active(email: str, active: bool) -> None:
    with Session(get_engine()) as db:
        user = db.scalar(select(User).where(User.email == email.lower()))
        if user is None:
            raise SystemExit("No account with this email.")
        user.is_active = active
        if not active:
            end_all_sessions(db, user.id)
        db.commit()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    staff = sub.add_parser("create-staff", help="Create an admin or supervisor account")
    staff.add_argument("--email", required=True)
    staff.add_argument("--name", required=True)
    staff.add_argument("--role", required=True, choices=STAFF_ROLES)

    active = sub.add_parser("set-active", help="Turn an account on or off")
    active.add_argument("--email", required=True)
    active.add_argument("--inactive", action="store_true")

    args = parser.parse_args(argv)
    if args.command == "create-staff":
        user = create_staff(args.email, args.name, args.role)
        print(f"Created {user.role} {user.email}")
    elif args.command == "set-active":
        set_active(args.email, not args.inactive)
        print("Done.")


if __name__ == "__main__":
    main(sys.argv[1:])
