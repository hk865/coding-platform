# Read-only function location task

Find the function matching the description in the provided source repository. Return its repository-relative file path, copy the complete function in a code block, and briefly explain the match using source evidence. Do not edit any files.

## Function description

1. **Purpose**: The function is designed to parse a string representing media type parameters into a structured format, extracting and interpreting each component, including quality factors and any additional parameters.
2. **Input**: A single string that typically includes a media type followed by semicolon-separated parameters.
3. **Output**: An object that includes the main media type value, a quality factor (defaulting to 1 if not specified), and an object containing any additional parameters specified in the input string.
4. **Procedure**: The function splits the input string by semicolons to separate the main value from any parameters. The first part is treated as the media type value. Subsequent parts are further split by equals signs to separate parameter names from their values. If a parameter is recognized as a quality factor ('q'), it is converted to a floating-point number; otherwise, it is stored as a string in the parameters object.
