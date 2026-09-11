# Read-only function location task

Find the function matching the description in the provided source repository. Return its repository-relative file path, copy the complete function in a code block, and briefly explain the match using source evidence. Do not edit any files.

## Function description

1. **Purpose**: The function is designed to handle the streaming of a file to the client, managing various events such as errors, directory access, and request abortion, ensuring a robust file transfer process.
2. **Input**: The function takes three parameters: a response object, a file stream, and an options object, along with a callback function to handle completion or errors.
3. **Output**: There is no direct return value; instead, the function uses the callback to signal completion or errors during the file transfer process.
4. **Procedure**: 
   - The function first sets up handlers for various file stream events including directory access, file access, streaming, and errors.
   - It listens for the end of the file stream and the completion of the response to handle normal and error conditions appropriately.
   - If specified in the options, headers are set on the response based on successful file transfer.
   - The file stream is piped directly to the response object, allowing for efficient data transfer.
   - The function ensures that the transfer is properly finalized or aborted based on the state of the request and any occurring errors.
