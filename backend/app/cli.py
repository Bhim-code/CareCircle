"""Admin commands run on the server. Admin and supervisor accounts are made only here.

    python -m app.cli create-org --name "Harbour Home Care"
    python -m app.cli create-staff --role supervisor --email sue@example.com --name "Sue" \
        --organization "Harbour Home Care"
    python -m app.cli create-staff --role admin --email al@example.com --name "Al"
    python -m app.cli set-company --email ana@example.com --organization "Harbour Home Care"
    python -m app.cli set-active --email someone@example.com --inactive

Supervisors must belong to a company and see only that company. Admins are global.

The password is asked for on screen, so it never lands in shell history.
"""

import argparse
import getpass
import sys

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.models import STAFF_ROLES, Organization, User, UserPreferences
from app.db.session import get_engine
from app.services.auth import end_all_sessions


def _find_org(db: Session, name: str) -> Organization:
    org = db.scalar(select(Organization).where(func.lower(Organization.name) == name.strip().lower()))
    if org is None:
        raise SystemExit(f"No company called {name!r}. Create it first with create-org.")
    return org


def create_org(name: str) -> Organization:
    with Session(get_engine(), expire_on_commit=False) as db:
        if db.scalar(select(Organization).where(func.lower(Organization.name) == name.strip().lower())):
            raise SystemExit("A company with this name already exists.")
        org = Organization(name=name.strip())
        db.add(org)
        db.commit()
        return org


def set_company(email: str, organization: str | None) -> None:
    with Session(get_engine()) as db:
        user = db.scalar(select(User).where(User.email == email.lower()))
        if user is None:
            raise SystemExit("No account with this email.")
        if user.role == "admin":
            raise SystemExit("Admins are global and cannot belong to a company.")
        if organization is None and user.role == "supervisor":
            raise SystemExit("A supervisor must belong to a company.")
        user.organization_id = _find_org(db, organization).id if organization else None
        db.commit()


def create_staff(email: str, name: str, role: str, password: str | None = None,
                 organization: str | None = None) -> User:
    if role not in STAFF_ROLES:
        raise SystemExit(f"Role must be one of {STAFF_ROLES}")
    if role == "supervisor" and not organization:
        raise SystemExit("A supervisor must belong to a company: add --organization \"Name\".")
    if role == "admin" and organization:
        raise SystemExit("Admins are global; leave out --organization.")
    password = password or getpass.getpass("Password (8+ characters): ")
    if len(password) < 8:
        raise SystemExit("Password must be at least 8 characters.")
    with Session(get_engine(), expire_on_commit=False) as db:
        if db.scalar(select(User).where(User.email == email.lower())):
            raise SystemExit("An account with this email already exists.")
        org_id = _find_org(db, organization).id if organization else None
        user = User(email=email.lower(), name=name, role=role, password_hash=hash_password(password),
                    organization_id=org_id)
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
    staff.add_argument("--organization", help="Company name (required for supervisors)")

    org = sub.add_parser("create-org", help="Create a care company")
    org.add_argument("--name", required=True)

    company = sub.add_parser("set-company", help="Put a patient, caregiver or supervisor in a company")
    company.add_argument("--email", required=True)
    company.add_argument("--organization", help="Company name; leave out to remove from a company")

    active = sub.add_parser("set-active", help="Turn an account on or off")
    active.add_argument("--email", required=True)
    active.add_argument("--inactive", action="store_true")

    args = parser.parse_args(argv)
    if args.command == "create-staff":
        user = create_staff(args.email, args.name, args.role, organization=args.organization)
        print(f"Created {user.role} {user.email}")
    elif args.command == "create-org":
        print(f"Created company {create_org(args.name).name}")
    elif args.command == "set-company":
        set_company(args.email, args.organization)
        print("Done.")
    elif args.command == "set-active":
        set_active(args.email, not args.inactive)
        print("Done.")


if __name__ == "__main__":
    main(sys.argv[1:])
