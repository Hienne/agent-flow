# P-no-mirror-models

**Rule.** Do not create or keep a view model plus a mapper that only renames or reselects the fields of an existing API type. Pass the API type directly (nullable until it is loaded) and give known-upfront values their own input. Make a view model only when two sources of different shape feed one consumer, or when the transformation is real and not a rename.

**Why.** A mirror adds a type, a mapper and a test that must follow the API forever, and its fields drift: some end up used by nothing.

**Violation.** `toHeaderCustomer(detail)` copying six fields into a second interface, one of them unused by any template.

**Apply.** Before reusing, moving or promoting an existing type or helper, read why it was created and ask whether that reason still holds. Check that every field of a view model has a reader. See `P-deletion-test`.
