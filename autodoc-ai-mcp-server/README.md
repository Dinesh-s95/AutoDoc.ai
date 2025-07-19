# AutoDoc.AI - MCP Server

AI-Enhanced Documentation Generator using OpenAI GPT-3.5-turbo.

## Features

- **AI-Powered Documentation**: Generate intelligent, professional documentation with OpenAI
- **Multi-Language Support**: Java, TypeScript, Python, C#
- **Framework Detection**: Spring Boot, Express, Django, .NET
- **Comprehensive Output**: Architecture docs, diagrams, API specs, compliance reports
- **MCP Integration**: Works seamlessly with Claude Desktop

##  Installation

1. Clone the repository
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Configure in Claude Desktop MCP settings
5. {
  "mcpServers": {
    "autodoc-ai": {
      "command": "node",
      "args": ["{project_path}/dist/index.js"]
    }
  }
}

##  Usage

Two main tools available:
- `generate_ai_documentation`: Generate docs with specific language/framework
- `detect_and_document`: Auto-detect project type and generate docs

##  Requirements

- Node.js 18+
- OpenAI API key
- Claude Desktop with MCP support

## Generated Documentation

- Main documentation with AI descriptions
- Architecture documentation
- PlantUML sequence diagrams
- Entity relationship diagrams
- OpenAPI specifications

  ## Usage example
  "Generate documentation for my Java Spring Boot project located at /path/to/my/project with output to /path/to/docs using OpenAI API key sk-..."
