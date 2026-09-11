def normalize_path(value):
    """Normalize Unix-like paths without accessing the filesystem.

    Collapses duplicate '/' separators and '.' segments, resolves '..'
    without escaping an absolute root (a leading relative '..' is preserved),
    removes a trailing separator (except for the root), and treats '...',
    spaces, and Unicode as literal names.
    """
    if not isinstance(value, str):
        raise TypeError("normalize_path() expects a string")
    if "\x00" in value:
        raise ValueError("path contains a NUL byte")

    absolute = value.startswith("/")
    stack = []
    for part in value.split("/"):
        if part == "" or part == ".":
            continue
        if part == "..":
            if stack and stack[-1] != "..":
                stack.pop()
            elif not absolute:
                stack.append("..")
            # For an absolute path at the root, '..' cannot move up and is dropped.
            continue
        stack.append(part)

    if not stack:
        return "/" if absolute else "."
    result = "/".join(stack)
    return "/" + result if absolute else result
