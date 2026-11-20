"""Deterministic replies from the in-memory recovery worker."""

import posixpath

WORKER_NAME = "recoveryworker"
WORKER_DIRECTORY = "/opt/deadletter"


def worker_reply(command, flag):
    # This table is the worker's entire filesystem.
    files = {f"{WORKER_DIRECTORY}/flag.txt": flag}
    words = command.split()
    if words == ["whoami"]:
        return WORKER_NAME
    if words == ["id"]:
        return f"uid=1001({WORKER_NAME}) gid=1001({WORKER_NAME}) groups=1001({WORKER_NAME})"
    if words == ["pwd"]:
        return WORKER_DIRECTORY
    if words in (["ls"], ["ls", WORKER_DIRECTORY]):
        return "\n".join(path.rsplit("/", 1)[1] for path in sorted(files))
    if len(words) == 2 and words[0] == "cat":
        path = posixpath.join(WORKER_DIRECTORY, words[1])
        if path in files:
            return files[path]
    return "Unsupported worker command."
