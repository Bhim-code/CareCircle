"""Base model for every request and response body.

Python code uses snake_case; JSON uses camelCase, as api-contract.md requires.
"""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
        extra="forbid",  # reject unknown fields instead of silently ignoring them
    )
