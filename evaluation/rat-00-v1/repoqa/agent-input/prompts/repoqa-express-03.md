# Read-only function location task

Find the function matching the description in the provided source repository. Return its repository-relative file path, copy the complete function in a code block, and briefly explain the match using source evidence. Do not edit any files.

## Function description

1. **Purpose**: The function is designed to safely convert a URL-encoded string back to its original representation.
2. **Input**: A single string which is expected to be URL-encoded.
3. **Output**: Returns the original string after decoding, or throws an error if the decoding fails.
4. **Procedure**: 
   - Checks if the input is a string and is not empty.
   - Attempts to decode the string using `decodeURIComponent`.
   - If decoding is successful, the decoded string is returned.
   - If a decoding error occurs (specifically a `URIError`), the error is modified to include a custom message and a status code, then rethrown.
