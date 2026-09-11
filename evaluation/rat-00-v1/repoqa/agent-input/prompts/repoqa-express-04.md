# Read-only function location task

Find the function matching the description in the provided source repository. Return its repository-relative file path, copy the complete function in a code block, and briefly explain the match using source evidence. Do not edit any files.

## Function description

1. **Purpose**: The function is designed to determine the type of a given variable, providing more specific type information especially for objects where it identifies the internal class.
2. **Input**: A single variable of any type.
3. **Output**: A string representing the type of the input variable. For non-object types, it returns the basic type (e.g., 'number', 'string'). For objects, it returns a more specific class type (e.g., 'Array', 'Date').
4. **Procedure**: The function first checks the basic type of the input. If it is not an object, it directly returns this type. If the input is an object, it uses a method to extract the internal class name from the object's constructor and returns this as the type.
