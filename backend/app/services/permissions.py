"""Roles and permissions: who may do what, and the rules for changing it.

Effective permissions = the person's role's permissions + their own extra ones.
An admin-kind role always has every permission. Someone "pending" has none.

Guardrails (agreed with the team):
- Nobody changes their own role or permissions (including by editing their own role).
- The last active supervisor of a company cannot be demoted or turned off.
- Every change is written to account_changes (append-only), so an admin can see
  what happened and put it back.
"""

import uuid

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.permissions import PANEL_PERMISSIONS, PERMISSIONS
from app.core.security import utcnow
from app.db.models import (
    AccountChange,
    CareLink,
    Permission,
    Role,
    RolePermission,
    User,
    UserPermission,
)
from app.services.auth import end_all_sessions


def role_permission_codes(db: Session, role_id: uuid.UUID | None) -> set[str]:
    if role_id is None:
        return set()
    return set(db.scalars(select(Permission.code).join(RolePermission)
                          .where(RolePermission.role_id == role_id)))


def extra_permission_codes(db: Session, user_id: uuid.UUID) -> set[str]:
    return set(db.scalars(select(Permission.code).join(UserPermission)
                          .where(UserPermission.user_id == user_id)))


def effective_permissions(db: Session, user: User) -> set[str]:
    if user.role == "pending" or not user.is_active:
        return set()
    if user.role == "admin":
        return set(PERMISSIONS)
    return role_permission_codes(db, user.role_id) | extra_permission_codes(db, user.id)


def has_permission(db: Session, user: User, code: str) -> bool:
    return code in effective_permissions(db, user)


def record_change(db: Session, user_id: uuid.UUID, actor_id: uuid.UUID | None, change: str,
                  before: dict | None, after: dict | None) -> None:
    db.add(AccountChange(user_id=user_id, changed_by=actor_id, change=change, before=before, after=after))


def _panel_only_for_staff(kind: str, codes: set[str]) -> None:
    """Admin panel permissions mean nothing for patients and caregivers (they cannot open it)."""
    if kind in ("patient", "caregiver") and codes & set(PANEL_PERMISSIONS):
        raise ApiError(422, "Admin panel permissions are only for supervisor roles.",
                       fields={"permissions": "Only for supervisor roles."})


def _not_self(actor: User, target: User, what: str) -> None:
    if actor.id == target.id:
        raise ApiError(403, f"You cannot change your own {what}. Ask another supervisor or an admin.",
                       code="not_self")


def _keeps_a_supervisor(db: Session, target: User) -> None:
    """Refuse if target is the last active supervisor of their company."""
    if target.role != "supervisor" or not target.is_active:
        return
    others = db.scalar(select(func.count()).where(
        User.role == "supervisor", User.is_active.is_(True), User.id != target.id,
        User.organization_id.is_not_distinct_from(target.organization_id)))
    if not others:
        raise ApiError(409, "This is the last active supervisor. Make someone else a supervisor first.",
                       code="last_supervisor")


def _role_info(db: Session, role_id: uuid.UUID | None) -> dict | None:
    role = db.get(Role, role_id) if role_id else None
    return {"id": str(role.id), "name": role.name, "kind": role.kind} if role else None


def assign_role(db: Session, actor: User, target: User, role: Role) -> None:
    """Give someone a role. Changing kind ends care links that no longer fit and signs them out."""
    _not_self(actor, target, "role")
    if role.kind == "admin" and actor.role != "admin":
        raise ApiError(403, "Only an admin can give the admin role.")
    if target.role_id == role.id:
        return
    old_kind = target.role
    if old_kind == "supervisor" and role.kind != "supervisor":
        _keeps_a_supervisor(db, target)
    if role.kind == "supervisor" and target.organization_id is None:
        if actor.organization_id is None:
            raise ApiError(422, "Put this person in a company before making them a supervisor.",
                           fields={"roleId": "No company yet."})
        target.organization_id = actor.organization_id
    if role.kind == "admin":
        target.organization_id = None

    before = {"role": _role_info(db, target.role_id), "kind": old_kind}
    target.role_id = role.id
    target.role = role.kind
    target.requested_role = None
    if old_kind != role.kind and old_kind != "pending":
        # A patient's caregivers, or a caregiver's patients, no longer apply.
        db.execute(update(CareLink).where(
            CareLink.status != "ended",
            (CareLink.patient_id == target.id) | (CareLink.caregiver_id == target.id))
            .values(status="ended", ended_at=utcnow(), ended_by=actor.id))
    end_all_sessions(db, target.id)  # their app must load the new role
    record_change(db, target.id, actor.id, "role", before,
                  {"role": _role_info(db, role.id), "kind": role.kind})


def set_extra_permissions(db: Session, actor: User, target: User, codes: set[str]) -> None:
    _not_self(actor, target, "permissions")
    unknown = codes - set(PERMISSIONS)
    if unknown:
        raise ApiError(422, fields={"permissions": f"Unknown: {', '.join(sorted(unknown))}"})
    _panel_only_for_staff(target.role, codes)
    before = sorted(extra_permission_codes(db, target.id))
    if set(before) == codes:
        return
    db.execute(delete(UserPermission).where(UserPermission.user_id == target.id))
    ids = dict(db.execute(select(Permission.code, Permission.id).where(Permission.code.in_(codes))).all())
    for code in sorted(codes):
        db.add(UserPermission(user_id=target.id, permission_id=ids[code], granted_by=actor.id))
    record_change(db, target.id, actor.id, "permissions", {"extra": before}, {"extra": sorted(codes)})


def set_active(db: Session, actor: User, target: User, active: bool) -> None:
    if actor.id == target.id and not active:
        raise ApiError(422, "You cannot turn off your own account.", fields={"isActive": "Not for yourself."})
    if target.is_active == active:
        return
    if not active:
        _keeps_a_supervisor(db, target)
        end_all_sessions(db, target.id)
    target.is_active = active
    record_change(db, target.id, actor.id, "active", {"isActive": not active}, {"isActive": active})


def set_role_permissions(db: Session, actor: User, role: Role, codes: set[str]) -> None:
    """Change what a role can do. Not your own role (that would change your own permissions)."""
    if role.kind == "admin":
        raise ApiError(403, "The admin role always has every permission.")
    if actor.role_id == role.id:
        raise ApiError(403, "You cannot change the permissions of your own role.", code="not_self")
    unknown = codes - set(PERMISSIONS)
    if unknown:
        raise ApiError(422, fields={"permissions": f"Unknown: {', '.join(sorted(unknown))}"})
    _panel_only_for_staff(role.kind, codes)
    if role.kind == "supervisor" and "panel.access" not in codes:
        raise ApiError(422, fields={"permissions": "A supervisor role needs 'panel.access'."})
    before = sorted(role_permission_codes(db, role.id))
    db.execute(delete(RolePermission).where(RolePermission.role_id == role.id))
    ids = db.scalars(select(Permission.id).where(Permission.code.in_(codes)))
    for pid in ids:
        db.add(RolePermission(role_id=role.id, permission_id=pid))
    # Logged against the person who made the change (roles are not people).
    record_change(db, actor.id, actor.id, "role_permissions",
                  {"role": role.name, "permissions": before}, {"role": role.name, "permissions": sorted(codes)})
