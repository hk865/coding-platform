# Read-only function location task

Find the function matching the description in the provided source repository. Return its repository-relative file path, copy the complete function in a code block, and briefly explain the match using source evidence. Do not edit any files.

## Function description

1. **Purpose**: To safely attempt to retrieve file metadata from the filesystem without throwing an error if the file does not exist.
2. **Input**: A string representing the file path.
3. **Output**: Returns the file metadata as an object if the file exists, or `undefined` if the file does not exist or an error occurs.
4. **Procedure**: The function attempts to access the file's metadata using a synchronous method. If the file is accessible, its metadata is returned. If the file is not found or another error occurs, the function catches the error and returns `undefined`, preventing the error from propagating.
