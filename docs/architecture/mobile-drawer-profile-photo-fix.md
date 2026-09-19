# Mobile drawer profile photo fix

The mobile More drawer keeps its existing profile entry, name, username, verification badge, and navigation behavior. The drawer avatar now synchronizes with the signed-in member's real profile photo when one is available.

The presentation bridge reuses already-rendered browser identity state (`profile-avatar-image`, `rail-avatar`, and `member-avatar`) and does not add database queries, API calls, or new backend state. The letter fallback remains available if no profile photo exists or the image cannot load.

The bridge watches existing avatar render state and drawer open/close state so profile-photo edits and later hydration can update the drawer without replacing the existing profile navigation contract.
