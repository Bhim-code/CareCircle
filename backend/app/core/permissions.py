"""The permission list (fixed in code) and the default roles (editable in the panel).

Why fixed: each permission is checked by a specific endpoint, so a permission
that is not in this list would do nothing. What IS dynamic, and stored in the
database: which role has which permission, new roles, and extra permissions
given to one person (see roles / role_permissions / user_permissions).

To add a permission: add it here, check it in an endpoint, and add a migration
that inserts it (see migrations/versions/*_roles_permissions.py).
"""

# code -> (group, plain description shown in the admin panel)
PERMISSIONS: dict[str, tuple[str, str]] = {
    # Admin panel
    "panel.access": ("Admin panel", "Sign in to the admin panel"),
    "people.view": ("Admin panel", "See the list of people and their profiles"),
    "people.create": ("Admin panel", "Create accounts"),
    "people.edit": ("Admin panel", "Edit profile details and photos"),
    "people.deactivate": ("Admin panel", "Turn accounts off and on (delete = turn off)"),
    "roles.assign": ("Admin panel", "Change a person's role"),
    "permissions.grant": ("Admin panel", "Give or remove a person's extra permissions"),
    "roles.manage": ("Admin panel", "Create roles and choose their permissions"),
    "records.view": ("Admin panel", "Open patients' records, reminders and documents"),
    "records.export": ("Admin panel", "Export records and reminders to CSV"),
    "audit.view": ("Admin panel", "See the access log"),
    # App
    "entries.write.medical": ("App", "Write medical records"),
    "entries.write.behavioural": ("App", "Write behavioural records"),
    "entries.write.incident": ("App", "Write incident records"),
    "entries.write.medication": ("App", "Write medication records"),
}

PANEL_PERMISSIONS = [code for code, (group, _) in PERMISSIONS.items() if group == "Admin panel"]

# What each kind of role means to the app. A role's kind decides the screens and data
# (a 'patient' kind has reminders; a 'caregiver' kind can be linked to patients);
# its permissions decide what the person may do.
KINDS = ("patient", "caregiver", "supervisor", "admin")

# The roles created at install time (api-contract.md "Who may do what").
DEFAULT_ROLES: list[dict] = [
    {"name": "Patient", "kind": "patient", "description": "Receives care and medicine reminders",
     "permissions": ["entries.write.medical", "entries.write.incident", "entries.write.medication"]},
    {"name": "Caregiver", "kind": "caregiver", "description": "Looks after linked patients",
     "permissions": ["entries.write.behavioural", "entries.write.incident", "entries.write.medication"]},
    {"name": "Supervisor", "kind": "supervisor", "description": "Runs the care team in the admin panel",
     "permissions": PANEL_PERMISSIONS},
    {"name": "Admin", "kind": "admin", "description": "Platform administrator (every permission)",
     "permissions": list(PERMISSIONS)},
]
