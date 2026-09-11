# Read-only function location task

Find the function matching the description in the provided source repository. Return its repository-relative file path, copy the complete function in a code block, and briefly explain the match using source evidence. Do not edit any files.

## Function description

1. **Purpose**: The function is designed to convert a JavaScript value into a JSON string. It enhances the standard JSON conversion by allowing optional character escaping to prevent HTML sniffing attacks.
2. **Input**: This function accepts four parameters: a value to be converted, an optional replacer function for altering how object values are stringified, an optional space value for adding indentation to the output, and a boolean to indicate whether certain characters should be escaped.
3. **Output**: It returns a JSON string representation of the input value. If the escape parameter is true, specific characters within the JSON string are replaced with their Unicode escape sequences to enhance security.
4. **Procedure**: Initially, the function checks if the replacer or space parameters are provided to use an enhanced JSON.stringify method. After converting the value to a JSON string, it conditionally checks if escaping is needed. If so, it replaces less-than, greater-than, and ampersand characters with their respective Unicode escape sequences to prevent misuse in HTML contexts.
