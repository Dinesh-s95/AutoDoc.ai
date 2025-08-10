# AutoDoc.ai MCP Server

## Overview

The AutoDoc.ai MCP (Model Context Protocol) Server is a powerful tool designed to automate the generation of documentation for microservices. It leverages OpenAI's GPT models to create AI-enhanced documentation and integrates with Jira for release notes generation. The server is built using TypeScript and provides a robust framework for managing documentation workflows.

---

## Key Components

### 1. mcp-server.ts

The `mcp-server.ts` file implements the core functionality of the MCP server. It is responsible for:

- **Tool Registration**: Registers tools to process microservice documentation and generate release notes.
- **Request Handling**: Manages requests for generating documentation and release notes.
- **Jira Integration**: Fetches ticket details from Jira to include in release notes.
- **Error Handling**: Implements robust error handling to ensure smooth operation.

#### Dependencies

- `fs/promises`: For file system operations.
- `path`: For handling file paths.
- `crypto`: For generating unique identifiers.

### 2. mcp-launcher.js

The `mcp-launcher.js` file serves as the entry point for the MCP server. It provides a user-friendly interface to configure and execute the server.

#### Key Features

1. **Configuration Validation**: Ensures all required configurations (e.g., OpenAI API key, Jira credentials) are set before starting the server.
2. **Documentation Generation**: Automates the generation of documentation for multiple microservices.
3. **Release Notes Generation**: Creates release notes by extracting Jira ticket information from commit messages.
4. **Interactive Mode**: Allows the server to run in an interactive mode for real-time requests.

#### Configuration

The script uses a `CONFIG` object to manage settings, including:

- OpenAI API key and model.
- Jira base URL, email, and API token.
- Paths for microservices and output directories.
- Documentation format (e.g., AsciiDoc, Markdown).

---

## Setup Instructions

### Prerequisites

1. **Node.js**: Ensure you have Node.js (v16 or later) installed.
2. **NPM**: Comes bundled with Node.js.
3. **Git**: For cloning the repository.

### Steps to Set Up Locally

1. Clone the repository:

   ```bash
   git clone https://github.com/Dinesh-s95/AutoDoc.ai.git
   ```

2. Navigate to the `autodoc-ai-mcp-server` directory:

   ```bash
   cd autodoc-ai-mcp-server
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Build the project:

   ```bash
   npm run build
   ```

   This will compile the TypeScript files into JavaScript and place them in the `dist` directory.

5. Configure the `CONFIG` object in `mcp-launcher.js` with your OpenAI and Jira credentials.

6. Run the desired command to generate documentation or start the server.

---

## Usage

### Commands

- **Generate Documentation for All Services**:

  ```bash
  node mcp-launcher.js all
  ```

- **Start Interactive Server**:

  ```bash
  node mcp-launcher.js server
  ```

- **Test Jira Connection**:
  ```bash
  node mcp-launcher.js test-jira
  ```

---

## Features

1. **AI-Enhanced Documentation**: Uses OpenAI's GPT models to generate detailed and structured documentation.
2. **Release Notes Generation**: Extracts Jira ticket information from commit messages to create release notes.
3. **Multi-Protocol Support**: Supports various communication protocols like REST, gRPC, and SOME/IP.
4. **Error Handling**: Provides detailed error messages and suggestions for resolving common issues.

---

## References

- [OpenAI API Documentation](https://platform.openai.com/docs/)
- [Jira REST API Documentation](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
- [Node.js Documentation](https://nodejs.org/en/docs/)
