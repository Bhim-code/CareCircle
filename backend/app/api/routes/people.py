"""People, roles and permissions, for the admin panel.

A supervisor (with the right permissions) can create people, edit their details and
photo, assign or change their role, give extra permissions, turn accounts off
("delete") and on, and create roles. Guardrails live in services/permissions.py.
Everything is limited to the supervisor's company and written to account_changes.
"""

import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.api.deps import CurrentUser
from app.api.routes.admin import _in_scope, _users_out, need, staff
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.permissions import PERMISSIONS
from app.core.security import hash_password, new_opaque_token, token_hash, utcnow
from app.db.models import (
    AccountChange,
    CareLink,
    Organization,
    PasswordResetToken,
    Role,
    User,
    UserPreferences,
    UserProfile,
)
from app.db.session import get_db
from app.schemas.admin import (
    ChangeOut,
    PermissionOut,
    PermissionsIn,
    PersonCreateIn,
    PersonUpdateIn,
    ProfileOut,
    RoleAssignIn,
    RoleIn,
    RoleOut,
    RoleUpdateIn,
    StaffMeOut,
)
from app.schemas.common import PersonWithEmailOut
from app.services import access, photos
from app.services import permissions as perms
from app.services.mailer import send_email

router = APIRouter(prefix="/admin", tags=["people, roles and permissions"])
files_router = APIRouter(tags=["files"])

_PROFILE_FIELDS = ("phone", "date_of_birth", "address", "emergency_contact_name",
                   "emergency_contact_phone", "notes")
_SET_PASSWORD_HOURS = 72


def _person(db: Session, me: CurrentUser, user_id: uuid.UUID, action: str | None = None) -> User:
    """A person the viewer may manage: same company (admin: anyone). Otherwise 404, logged."""
    user = db.get(User, user_id)
    if user is None:
        raise ApiError(404)
    if not _in_scope(me, user):
        access.log_access(db, me.user, user.id, action or "person.view", outcome="denied")
        db.commit()
        raise ApiError(404)
    return user


def _profile(db: Session, user_id: uuid.UUID) -> UserProfile:
    profile = db.get(UserProfile, user_id)
    if profile is None:
        profile = UserProfile(user_id=user_id)
        db.add(profile)
        db.flush()
    return profile


def _role(db: Session, role_id: uuid.UUID) -> Role:
    role = db.get(Role, role_id)
    if role is None:
        raise ApiError(422, fields={"roleId": "No such role."})
    return role


# --- who am I (for the panel's menus) ------------------------------------------

@router.get("/me", response_model=StaffMeOut)
def staff_me(me: CurrentUser = Depends(staff), db: Session = Depends(get_db)) -> StaffMeOut:
    return StaffMeOut(person=_users_out(db, [me.user])[0],
                      permissions=sorted(perms.effective_permissions(db, me.user)))


# --- permissions and roles -----------------------------------------------------

@router.get("/permissions", response_model=list[PermissionOut])
def list_permissions(me: CurrentUser = Depends(staff)) -> list[PermissionOut]:
    """The fixed list of permissions, grouped for display."""
    return [PermissionOut(code=c, group=g, description=d) for c, (g, d) in PERMISSIONS.items()]


def _roles_out(db: Session, roles: list[Role], me: CurrentUser) -> list[RoleOut]:
    counts = dict(db.execute(_scope_users(select(User.role_id, func.count()), me)
                             .where(User.role_id.is_not(None)).group_by(User.role_id)).all())
    out = []
    for role in roles:
        codes = sorted(PERMISSIONS) if role.kind == "admin" else sorted(perms.role_permission_codes(db, role.id))
        out.append(RoleOut(id=role.id, name=role.name, kind=role.kind, description=role.description,
                           is_system=role.is_system, permissions=codes, people=counts.get(role.id, 0)))
    return out


def _scope_users(query, me: CurrentUser):
    if me.role == "admin":
        return query
    return query.where(User.organization_id == me.user.organization_id)


@router.get("/roles", response_model=list[RoleOut])
def list_roles(me: CurrentUser = Depends(need("people.view")), db: Session = Depends(get_db)):
    """Every role with its permissions and how many people (in your company) have it."""
    order = {"patient": 0, "caregiver": 1, "supervisor": 2, "admin": 3}
    roles = sorted(db.scalars(select(Role)), key=lambda r: (order[r.kind], not r.is_system, r.name.lower()))
    if me.role != "admin":
        roles = [r for r in roles if r.kind != "admin"]
    return _roles_out(db, roles, me)


@router.post("/roles", response_model=RoleOut, status_code=201)
def create_role(body: RoleIn, me: CurrentUser = Depends(need("roles.manage")), db: Session = Depends(get_db)):
    """A new role, e.g. "Night nurse" (kind caregiver) with its own permissions."""
    role = Role(name=body.name, kind=body.kind, description=body.description)
    db.add(role)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "A role with this name already exists.", fields={"name": "Choose another name."}) from None
    perms.set_role_permissions(db, me.user, role, set(body.permissions))
    db.commit()
    return _roles_out(db, [role], me)[0]


@router.patch("/roles/{role_id}", response_model=RoleOut)
def update_role(role_id: uuid.UUID, body: RoleUpdateIn, me: CurrentUser = Depends(need("roles.manage")),
                db: Session = Depends(get_db)):
    """Rename a role or change its permissions (not your own role, not Admin).
    Built-in roles keep their name; their permissions can change."""
    role = db.get(Role, role_id)
    if role is None or (role.kind == "admin" and me.role != "admin"):
        raise ApiError(404)
    if body.name is not None and body.name != role.name:
        if role.is_system:
            raise ApiError(422, fields={"name": "Built-in roles keep their name."})
        role.name = body.name
    if body.description is not None:
        role.description = body.description
    if body.permissions is not None:
        perms.set_role_permissions(db, me.user, role, set(body.permissions))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "A role with this name already exists.", fields={"name": "Choose another name."}) from None
    return _roles_out(db, [role], me)[0]


@router.delete("/roles/{role_id}", status_code=204)
def delete_role(role_id: uuid.UUID, me: CurrentUser = Depends(need("roles.manage")),
                db: Session = Depends(get_db)) -> Response:
    """Only roles you created, and only when nobody has them."""
    role = db.get(Role, role_id)
    if role is None or (role.kind == "admin" and me.role != "admin"):
        raise ApiError(404)
    if role.is_system:
        raise ApiError(422, "Built-in roles cannot be deleted.", fields={"roleId": "Built-in role."})
    if db.scalar(select(func.count()).where(User.role_id == role.id)):
        raise ApiError(409, "People still have this role. Give them another role first.", code="role_in_use")
    db.delete(role)
    perms.record_change(db, me.id, me.id, "role_deleted", {"role": role.name}, None)
    db.commit()
    return Response(status_code=204)


# --- people ----------------------------------------------------------------------

@router.post("/users", status_code=201, response_model=ProfileOut)
def create_person(body: PersonCreateIn, me: CurrentUser = Depends(need("people.create")),
                  db: Session = Depends(get_db)) -> ProfileOut:
    """Create an account in your company. They get an email to choose their password."""
    role = _role(db, body.role_id) if body.role_id else None
    if role and role.kind == "admin" and me.role != "admin":
        raise ApiError(403, "Only an admin can give the admin role.")
    if role and not perms.has_permission(db, me.user, "roles.assign"):
        raise ApiError(403, "You need the 'roles.assign' permission to give a role.", code="missing_permission")
    company = None if (role and role.kind == "admin") else me.user.organization_id
    user = User(email=body.email, name=body.name, role=role.kind if role else "pending",
                role_id=role.id if role else None, organization_id=company,
                # Unusable until they choose one from the email link.
                password_hash=hash_password(new_opaque_token()))
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "An account with this email already exists.", code="email_taken",
                       fields={"email": "Already registered."}) from None
    db.add(UserPreferences(user_id=user.id))
    profile = _profile(db, user.id)
    for field in _PROFILE_FIELDS:
        setattr(profile, field, getattr(body, field))
    perms.record_change(db, user.id, me.id, "created", None,
                        {"name": user.name, "email": user.email, "role": role.name if role else "pending"})
    token = new_opaque_token()
    db.add(PasswordResetToken(user_id=user.id, token_hash=token_hash(token),
                              expires_at=utcnow() + timedelta(hours=_SET_PASSWORD_HOURS)))
    db.commit()
    send_email(user.email, "Your CareCircle account",
               f"Hello {user.name},\n\n{me.user.name} has created a CareCircle account for you.\n"
               f"Choose your password within {_SET_PASSWORD_HOURS} hours with this link:\n\n"
               f"{get_settings().password_reset_url}?token={token}\n")
    return _profile_out(db, me, user)


def _profile_out(db: Session, me: CurrentUser, user: User) -> ProfileOut:
    profile = db.get(UserProfile, user.id)
    by = aliased(User)
    changes = db.execute(select(AccountChange, by).outerjoin(by, by.id == AccountChange.changed_by)
                         .where(AccountChange.user_id == user.id)
                         .order_by(AccountChange.at.desc(), AccountChange.id.desc()).limit(50)).all()
    links = db.scalar(select(func.count()).where(
        CareLink.status == "active", (CareLink.patient_id == user.id) | (CareLink.caregiver_id == user.id))) or 0
    return ProfileOut(
        person=_users_out(db, [user])[0],
        **{f: getattr(profile, f) if profile else None for f in _PROFILE_FIELDS},
        role_permissions=sorted(PERMISSIONS) if user.role == "admin"
        else sorted(perms.role_permission_codes(db, user.role_id)),
        extra_permissions=sorted(perms.extra_permission_codes(db, user.id)),
        effective_permissions=sorted(perms.effective_permissions(db, user)),
        active_links=links,
        history=[ChangeOut(at=c.at, change=c.change, by=PersonWithEmailOut.model_validate(b) if b else None,
                           before=c.before, after=c.after) for c, b in changes],
    )


@router.get("/users/{user_id}", response_model=ProfileOut)
def get_person(user_id: uuid.UUID, me: CurrentUser = Depends(need("people.view")),
               db: Session = Depends(get_db)) -> ProfileOut:
    """The profile page: details, photo, role, permissions and history."""
    user = _person(db, me, user_id, "profile.view")
    access.log_access(db, me.user, user.id, "profile.view")
    db.commit()
    return _profile_out(db, me, user)


@router.patch("/users/{user_id}", response_model=ProfileOut)
def update_person(user_id: uuid.UUID, body: PersonUpdateIn, me: CurrentUser = Depends(staff),
                  db: Session = Depends(get_db)) -> ProfileOut:
    user = _person(db, me, user_id, "profile.edit")
    sent = body.model_fields_set

    def require(code: str) -> None:
        if not perms.has_permission(db, me.user, code):
            raise ApiError(403, f"You need the '{code}' permission for this.", code="missing_permission")

    details = sent & ({"name"} | set(_PROFILE_FIELDS))
    if details:
        require("people.edit")
        profile = _profile(db, user.id)
        before, after = {}, {}
        for field in details:
            target = user if field == "name" else profile
            old, new = getattr(target, field), getattr(body, field)
            if field == "name" and new is None:
                raise ApiError(422, fields={"name": "A name is required."})
            if old != new:
                before[field], after[field] = str(old) if old is not None else None, \
                    str(new) if new is not None else None
                setattr(target, field, new)
        if after:
            perms.record_change(db, user.id, me.id, "details", before, after)
    if "organization_id" in sent:
        if me.role != "admin":
            raise ApiError(403, "Only an admin can move people between companies.")
        if user.role == "admin":
            raise ApiError(422, "Admins are global and cannot belong to a company.",
                           fields={"organizationId": "Not for admins."})
        if body.organization_id is None and user.role == "supervisor":
            raise ApiError(422, "A supervisor must belong to a company.", fields={"organizationId": "Choose a company."})
        if body.organization_id is not None and db.get(Organization, body.organization_id) is None:
            raise ApiError(422, fields={"organizationId": "No such company."})
        if user.organization_id != body.organization_id:
            perms.record_change(db, user.id, me.id, "company",
                                {"organizationId": str(user.organization_id) if user.organization_id else None},
                                {"organizationId": str(body.organization_id) if body.organization_id else None})
            user.organization_id = body.organization_id
            access.log_access(db, me.user, user.id, "user.company")
    if "is_active" in sent and body.is_active is not None:
        require("people.deactivate")
        was = user.is_active
        perms.set_active(db, me.user, user, body.is_active)
        if was != user.is_active:
            access.log_access(db, me.user, user.id, "user.activate" if user.is_active else "user.deactivate")
    db.commit()
    return _profile_out(db, me, user)


@router.delete("/users/{user_id}", status_code=204)
def delete_person(user_id: uuid.UUID, me: CurrentUser = Depends(need("people.deactivate")),
                  db: Session = Depends(get_db)) -> Response:
    """"Delete" = turn the account off. Records and history are kept (health data)."""
    user = _person(db, me, user_id, "user.deactivate")
    perms.set_active(db, me.user, user, False)
    access.log_access(db, me.user, user.id, "user.deactivate")
    db.commit()
    return Response(status_code=204)


@router.put("/users/{user_id}/role", response_model=ProfileOut)
def assign_role(user_id: uuid.UUID, body: RoleAssignIn, me: CurrentUser = Depends(need("roles.assign")),
                db: Session = Depends(get_db)) -> ProfileOut:
    """Give or change someone's role. A change of kind (e.g. patient -> caregiver) ends
    their care links and signs them out; their own records are kept."""
    user = _person(db, me, user_id, "role.assign")
    perms.assign_role(db, me.user, user, _role(db, body.role_id))
    access.log_access(db, me.user, user.id, "role.assign")
    db.commit()
    return _profile_out(db, me, user)


@router.put("/users/{user_id}/permissions", response_model=ProfileOut)
def set_permissions(user_id: uuid.UUID, body: PermissionsIn,
                    me: CurrentUser = Depends(need("permissions.grant")),
                    db: Session = Depends(get_db)) -> ProfileOut:
    """Replace someone's extra permissions (on top of their role's)."""
    user = _person(db, me, user_id, "permissions.grant")
    if user.role == "pending":
        raise ApiError(422, "Give this person a role first.", fields={"permissions": "No role yet."})
    perms.set_extra_permissions(db, me.user, user, set(body.permissions))
    access.log_access(db, me.user, user.id, "permissions.grant")
    db.commit()
    return _profile_out(db, me, user)


@router.post("/users/{user_id}/photo", response_model=ProfileOut,
             responses={413: {"description": "Larger than 5 MB."}, 415: {"description": "Not JPEG or PNG."}})
async def upload_photo(user_id: uuid.UUID, file: UploadFile = File(...),
                       me: CurrentUser = Depends(need("people.edit")),
                       db: Session = Depends(get_db)) -> ProfileOut:
    user = _person(db, me, user_id, "photo.upload")
    data = await file.read(photos.MAX_BYTES + 1)
    if len(data) > photos.MAX_BYTES:
        raise ApiError(413, "The photo must be 5 MB or smaller.", fields={"file": "Too large."})
    kind = photos.sniff_type(data)
    if not data or kind is None:
        raise ApiError(415, "Only JPEG and PNG photos are accepted.", fields={"file": "Wrong type."})
    profile = _profile(db, user.id)
    old = profile.photo_key
    profile.photo_key = photos.save_profile_photo(data, kind[1])
    profile.photo_type = kind[0]
    perms.record_change(db, user.id, me.id, "photo", None, {"photo": "changed"})
    db.commit()
    photos.remove_profile_photo(old)
    return _profile_out(db, me, user)


@router.delete("/users/{user_id}/photo", response_model=ProfileOut)
def delete_photo(user_id: uuid.UUID, me: CurrentUser = Depends(need("people.edit")),
                 db: Session = Depends(get_db)) -> ProfileOut:
    user = _person(db, me, user_id, "photo.delete")
    profile = _profile(db, user.id)
    old, profile.photo_key, profile.photo_type = profile.photo_key, None, None
    if old:
        perms.record_change(db, user.id, me.id, "photo", None, {"photo": "removed"})
    db.commit()
    photos.remove_profile_photo(old)
    return _profile_out(db, me, user)


@files_router.get("/files/profile-photos/{user_id}", responses={404: {"description": "Unknown or expired."}})
def get_profile_photo(user_id: uuid.UUID, v: Annotated[str, Query(max_length=100)], expires: int,
                      sig: Annotated[str, Query(max_length=128)], db: Session = Depends(get_db)) -> FileResponse:
    """Signed, expiring link (handed out only to staff allowed to see the person)."""
    profile = db.get(UserProfile, user_id)
    if (profile is None or profile.photo_key != v
            or not photos.profile_signature_ok(user_id, v, expires, sig)):
        raise ApiError(404)
    path = photos.profile_dir() / profile.photo_key
    if not path.is_file():
        raise ApiError(404)
    return FileResponse(path, media_type=profile.photo_type, headers={"Cache-Control": "private, no-store"})

