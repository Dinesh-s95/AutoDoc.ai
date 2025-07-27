import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolResult,
  TextContent,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';

// Interface for class summary structure
interface ClassSummary {
  className: string;
  annotations: string[];
  methods: string[];
  endpoints: string[];
  fields: string[];
  isEntity: boolean;
  isRestController: boolean;
}

// Configuration interface
interface ServerConfig {
  openaiApiKey: string;
  openaiModel: string;
  microservicePath: string;
  outputPath: string;
  docFormat: string;
  logLevel: string;
  autoRunPipeline: boolean;
}

class JavaDocumentationMCPServer {
  private server: Server;
  private openai: OpenAI;
  private config: ServerConfig;

  constructor() {
    // Load configuration from environment variables
    this.config = {
      openaiApiKey: process.env.OPENAI_API_KEY || '',
      openaiModel: process.env.OPENAI_MODEL || 'gpt-4',
      microservicePath: process.env.MICROSERVICE_PATH || '',
      outputPath: process.env.OUTPUT_PATH || './output',
      docFormat: process.env.DOC_FORMAT || 'adoc',
      logLevel: process.env.LOG_LEVEL || 'info',
      autoRunPipeline: process.env.AUTO_RUN_PIPELINE === 'true',
    };

    this.server = new Server(
      {
        name: 'java-documentation-server',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize OpenAI client
    if (!this.config.openaiApiKey) {
      this.logError('OPENAI_API_KEY environment variable is required');
      process.exit(1);
    }

    this.openai = new OpenAI({
      apiKey: this.config.openaiApiKey,
    });

    this.logInfo('Server initialized with configuration:', {
      model: this.config.openaiModel,
      microservicePath: this.config.microservicePath,
      outputPath: this.config.outputPath,
      format: this.config.docFormat,
    });

    this.setupToolHandlers();
  }

  private log(level: string, message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    if (data) {
      console.error(`${logMessage}`, JSON.stringify(data, null, 2));
    } else {
      console.error(logMessage);
    }
  }

  private logInfo(message: string, data?: any) {
    if (['debug', 'info'].includes(this.config.logLevel)) {
      this.log('info', message, data);
    }
  }

  private logError(message: string, data?: any) {
    this.log('error', message, data);
  }

  private logDebug(message: string, data?: any) {
    if (this.config.logLevel === 'debug') {
      this.log('debug', message, data);
    }
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = [
        {
          name: 'analyze_java_project',
          description: 'Analyze Java project structure and generate classes-summary.json',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Java project directory (optional, uses env MICROSERVICE_PATH if not provided)',
              },
            },
            required: [],
          },
        },
        {
          name: 'generate_documentation',
          description: 'Generate comprehensive documentation from classes-summary.json using OpenAI',
          inputSchema: {
            type: 'object',
            properties: {
              classesSummaryPath: {
                type: 'string',
                description: 'Path to the classes-summary.json file (optional, auto-detected)',
              },
              outputFormat: {
                type: 'string',
                enum: ['markdown', 'adoc'],
                description: 'Output format for documentation (optional, uses env DOC_FORMAT)',
              },
              outputDir: {
                type: 'string',
                description: 'Directory to save documentation (optional, uses env OUTPUT_PATH)',
              },
            },
            required: [],
          },
        },
        {
          name: 'full_pipeline',
          description: 'Complete pipeline: analyze Java project and generate documentation',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Java project directory (optional, uses env MICROSERVICE_PATH)',
              },
              outputDir: {
                type: 'string',
                description: 'Directory to save generated documentation (optional, uses env OUTPUT_PATH)',
              },
              outputFormat: {
                type: 'string',
                enum: ['markdown', 'adoc'],
                description: 'Output format for documentation (optional, uses env DOC_FORMAT)',
              },
            },
            required: [],
          },
        },
        {
          name: 'get_config',
          description: 'Get current server configuration',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ];

      this.logDebug('Registered tools:', tools.map(t => t.name));
      
      return {
        tools,
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        this.logDebug(`CallToolRequestSchema handler called with:`, {
          name: request.params.name,
          arguments: request.params.arguments
        });

        switch (request.params.name) {
          case 'analyze_java_project':
            return await this.analyzeJavaProject(request.params.arguments);
          case 'generate_documentation':
            return await this.generateDocumentation(request.params.arguments);
          case 'full_pipeline':
            return await this.fullPipeline(request.params.arguments);
          case 'get_config':
            return await this.getConfig();
          default:
            const availableTools = ['analyze_java_project', 'generate_documentation', 'full_pipeline', 'get_config'];
            this.logError(`Unknown tool requested: ${request.params.name}. Available tools: ${availableTools.join(', ')}`);
            
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Error: Unknown tool: ${request.params.name}\n\n💡 Available tools:\n${availableTools.map(tool => `- ${tool}`).join('\n')}\n\n💡 **Troubleshooting Tips:**\n- Check that your project path exists and contains source files\n- Verify your OpenAI API key is valid and starts with "sk-"\n- Ensure you have write permissions to the output directory\n- For Java projects, make sure you have .java files in src/ directories\n- Check that your OpenAI account has available credits`,
                },
              ],
              isError: true,
            } satisfies CallToolResult;
        }
      } catch (error) {
        this.logError(`Tool execution failed: ${request.params.name}`, error);
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error executing ${request.params.name}: ${error instanceof Error ? error.message : String(error)}\n\n💡 **Troubleshooting Tips:**\n- Check that your project path exists and contains source files\n- Verify your OpenAI API key is valid and starts with "sk-"\n- Ensure you have write permissions to the output directory\n- For Java projects, make sure you have .java files in src/ directories\n- Check that your OpenAI account has available credits`,
            },
          ],
          isError: true,
        } satisfies CallToolResult;
      }
    });

    this.logInfo('✅ MCP 1.15.1 tools registered with correct schemas');
  }

  private async getConfig(): Promise<CallToolResult> {
    const configDisplay = {
      ...this.config,
      openaiApiKey: this.config.openaiApiKey ? '***CONFIGURED***' : '***NOT SET***',
    };

    return {
      content: [
        {
          type: 'text',
          text: `Current Server Configuration:\n${JSON.stringify(configDisplay, null, 2)}`,
        },
      ],
    };
  }

  private async analyzeJavaProject(args: any): Promise<CallToolResult> {
    const projectPath = args?.projectPath || this.config.microservicePath;
    
    if (!projectPath) {
      throw new Error('projectPath is required (either as parameter or MICROSERVICE_PATH env var)');
    }

    this.logInfo(`🔍 Analyzing Java project at: ${projectPath}`);
    
    // Check if project path exists
    try {
      await fs.access(projectPath);
    } catch (error) {
      throw new Error(`Project path does not exist or is not accessible: ${projectPath}`);
    }
    
    const classesSummary = await this.parseJavaFiles(projectPath);
    
    if (classesSummary.length === 0) {
      throw new Error(`No Java classes found in project path: ${projectPath}. Make sure the path contains .java files.`);
    }
    
    const outputPath = path.join(this.config.outputPath, 'classes-summary.json');
    
    // Ensure output directory exists
    await fs.mkdir(this.config.outputPath, { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(classesSummary, null, 2));

    this.logInfo(`📄 Classes summary generated: ${outputPath}`);

    return {
      content: [
        {
          type: 'text',
          text: `✅ Successfully analyzed Java project and generated classes-summary.json at ${outputPath}\n\n📊 Found ${classesSummary.length} classes:\n${classesSummary.map(c => `- ${c.className}`).join('\n')}`,
        },
      ],
    };
  }

  private async generateDocumentation(args: any): Promise<CallToolResult> {
    const classesSummaryPath = args?.classesSummaryPath || path.join(this.config.outputPath, 'classes-summary.json');
    const outputFormat = args?.outputFormat || this.config.docFormat;
    const outputDir = args?.outputDir || this.config.outputPath;
    
    this.logInfo(`📝 Generating documentation from: ${classesSummaryPath}`);
    
    // Check if classes summary file exists
    try {
      await fs.access(classesSummaryPath);
    } catch (error) {
      throw new Error(`Classes summary file not found: ${classesSummaryPath}. Run analyze_java_project first.`);
    }
    
    const classesSummaryContent = await fs.readFile(classesSummaryPath, 'utf-8');
    const classesSummary = JSON.parse(classesSummaryContent);

    if (!Array.isArray(classesSummary) || classesSummary.length === 0) {
      throw new Error(`Invalid or empty classes summary in ${classesSummaryPath}`);
    }

    await fs.mkdir(outputDir, { recursive: true });

    // Generate three separate documentation files
    const generatedFiles: string[] = [];

    // 1. Generate Architecture Design Document
    this.logInfo('📐 Generating Architecture Design Document...');
    const architectureDoc = await this.generateArchitectureDesign(classesSummary, outputFormat);
    const architectureFile = path.join(outputDir, `architecturedesign.${outputFormat}`);
    await fs.writeFile(architectureFile, architectureDoc);
    generatedFiles.push(architectureFile);

    // 2. Generate Detailed Design Document
    this.logInfo('🔍 Generating Detailed Design Document...');
    const detailedDoc = await this.generateDetailedDesign(classesSummary, outputFormat);
    const detailedFile = path.join(outputDir, `detaileddesign.${outputFormat}`);
    await fs.writeFile(detailedFile, detailedDoc);
    generatedFiles.push(detailedFile);

    // 3. Generate OpenAPI Specification Document
    this.logInfo('📋 Generating OpenAPI Specification Document...');
    const openApiDoc = await this.generateOpenApiSpecification(classesSummary, outputFormat);
    const openApiFile = path.join(outputDir, `openApiSpecification.${outputFormat}`);
    await fs.writeFile(openApiFile, openApiDoc);
    generatedFiles.push(openApiFile);

    this.logInfo(`📚 All documentation files generated successfully`);

    return {
      content: [
        {
          type: 'text',
          text: `✅ Successfully generated ${outputFormat.toUpperCase()} documentation files:\n${generatedFiles.map(file => `- ${path.basename(file)}`).join('\n')}`,
        },
      ],
    };
  }

  private async fullPipeline(args: any): Promise<CallToolResult> {
    const projectPath = args?.projectPath || this.config.microservicePath;
    const outputDir = args?.outputDir || this.config.outputPath;
    const outputFormat = args?.outputFormat || this.config.docFormat;
    
    if (!projectPath) {
      throw new Error('projectPath is required (either as parameter or MICROSERVICE_PATH env var)');
    }

    this.logInfo(`🚀 Running full pipeline for project: ${projectPath}`);
    
    // Check if project path exists
    try {
      await fs.access(projectPath);
    } catch (error) {
      throw new Error(`Project path does not exist or is not accessible: ${projectPath}`);
    }
    
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Step 1: Analyze Java project
    this.logInfo('📋 Step 1: Analyzing Java project...');
    const classesSummary = await this.parseJavaFiles(projectPath);
    
    if (classesSummary.length === 0) {
      throw new Error(`No Java classes found in project path: ${projectPath}. Make sure the path contains .java files in src/ directories.`);
    }
    
    const classesSummaryPath = path.join(outputDir, 'classes-summary.json');
    await fs.writeFile(classesSummaryPath, JSON.stringify(classesSummary, null, 2));

    // Step 2: Generate documentation
    this.logInfo('🤖 Step 2: Generating documentation with OpenAI...');
    
    const generatedFiles: string[] = [];

    // Generate Architecture Design Document
    this.logInfo('📐 Generating Architecture Design Document...');
    const architectureDoc = await this.generateArchitectureDesign(classesSummary, outputFormat);
    const architectureFile = path.join(outputDir, `architecturedesign.${outputFormat}`);
    await fs.writeFile(architectureFile, architectureDoc);
    generatedFiles.push(architectureFile);

    // Generate Detailed Design Document
    this.logInfo('🔍 Generating Detailed Design Document...');
    const detailedDoc = await this.generateDetailedDesign(classesSummary, outputFormat);
    const detailedFile = path.join(outputDir, `detaileddesign.${outputFormat}`);
    await fs.writeFile(detailedFile, detailedDoc);
    generatedFiles.push(detailedFile);

    // Generate OpenAPI Specification Document
    this.logInfo('📋 Generating OpenAPI Specification Document...');
    const openApiDoc = await this.generateOpenApiSpecification(classesSummary, outputFormat);
    const openApiFile = path.join(outputDir, `openApiSpecification.${outputFormat}`);
    await fs.writeFile(openApiFile, openApiDoc);
    generatedFiles.push(openApiFile);

    this.logInfo('✅ Full pipeline completed successfully');

    return {
      content: [
        {
          type: 'text',
          text: `🎉 Full pipeline completed successfully!\n\n📁 Generated files:\n- ${classesSummaryPath}\n${generatedFiles.map(file => `- ${file}`).join('\n')}\n\n📊 Analyzed ${classesSummary.length} classes from the project:\n${classesSummary.map(c => `- ${c.className}`).join('\n')}`,
        },
      ],
    };
  }

  private async parseJavaFiles(projectPath: string): Promise<ClassSummary[]> {
    const classesSummary: ClassSummary[] = [];
    
    this.logDebug(`Starting to parse Java files in: ${projectPath}`);
    const javaFiles = await this.findJavaFiles(projectPath);
    this.logInfo(`Found ${javaFiles.length} Java files to analyze`);
    
    if (javaFiles.length === 0) {
      this.logError(`No .java files found in ${projectPath}`);
      return classesSummary;
    }
    
    for (const javaFile of javaFiles) {
      try {
        const content = await fs.readFile(javaFile, 'utf-8');
        const classInfo = this.parseJavaClass(content);
        if (classInfo) {
          classesSummary.push(classInfo);
          this.logDebug(`Parsed class: ${classInfo.className}`);
        }
      } catch (error) {
        this.logError(`Failed to parse file: ${javaFile}`, error);
      }
    }
    
    return classesSummary;
  }

  private async findJavaFiles(dir: string): Promise<string[]> {
    const javaFiles: string[] = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'target' && entry.name !== 'build') {
          const subFiles = await this.findJavaFiles(fullPath);
          javaFiles.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith('.java')) {
          javaFiles.push(fullPath);
        }
      }
    } catch (error) {
      this.logError(`Error reading directory: ${dir}`, error);
    }
    
    return javaFiles;
  }

  private parseJavaClass(content: string): ClassSummary | null {
    const annotations: string[] = [];
    const methods: string[] = [];
    const endpoints: string[] = [];
    const fields: string[] = [];
    let isEntity = false;
    let isRestController = false;

    // Extract class name
    const classMatch = content.match(/(?:public\s+)?(?:class|interface|enum)\s+(\w+)/);
    if (!classMatch) {
      return null; // Skip if no class found
    }
    const className = classMatch[1];

    // Parse annotations
    const annotationMatches = content.match(/@\w+/g);
    if (annotationMatches) {
      annotationMatches.forEach(annotation => {
        const cleanAnnotation = annotation.replace('@', '');
        if (!annotations.includes(cleanAnnotation)) {
          annotations.push(cleanAnnotation);
        }
        
        if (cleanAnnotation === 'Entity') isEntity = true;
        if (cleanAnnotation === 'RestController') isRestController = true;
      });
    }

    // Parse methods
    const methodMatches = content.match(/(?:public|private|protected)\s+[\w<>?,\s\[\]]+\s+\w+\s*\([^)]*\)(?:\s+throws\s+[\w,\s]+)?/g);
    if (methodMatches) {
      methodMatches.forEach(method => {
        const cleanMethod = method.trim().replace(/\s+/g, ' ');
        if (!methods.includes(cleanMethod)) {
          methods.push(cleanMethod);
        }
      });
    }

    // Parse fields
    const fieldMatches = content.match(/(?:private|protected|public)\s+[\w<>?,\s\[\]]+\s+\w+(?:\s*=.*?)?;/g);
    if (fieldMatches) {
      fieldMatches.forEach(field => {
        const fieldMatch = field.match(/(?:private|protected|public)\s+([\w<>?,\s\[\]]+)\s+(\w+)/);
        if (fieldMatch) {
          const fieldType = fieldMatch[1].trim();
          const fieldName = fieldMatch[2];
          const fieldEntry = `${fieldName} : ${fieldType}`;
          if (!fields.includes(fieldEntry)) {
            fields.push(fieldEntry);
          }
        }
      });
    }

    // Parse endpoints (basic extraction)
    const mappingMatches = content.match(/@(GetMapping|PostMapping|PutMapping|DeleteMapping|RequestMapping)[^}]*/g);
    if (mappingMatches) {
      mappingMatches.forEach(mapping => {
        const methodMatch = content.match(new RegExp(mapping.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*?public.*?(\\w+)\\s*\\('));
        if (methodMatch) {
          const mappingType = mapping.match(/@(\w+)/)?.[1] || 'Mapping';
          const endpointEntry = `${mappingType} -> ${methodMatch[1]}`;
          if (!endpoints.includes(endpointEntry)) {
            endpoints.push(endpointEntry);
          }
        }
      });
    }

    return {
      className,
      annotations: annotations.sort(),
      methods: methods.sort(),
      endpoints: endpoints.sort(),
      fields: fields.sort(),
      isEntity,
      isRestController,
    };
  }

  private async generateArchitectureDesign(classesSummary: ClassSummary[], outputFormat: string): Promise<string> {
    this.logInfo(`Generating Architecture Design using OpenAI model: ${this.config.openaiModel}`);

    if (!this.config.openaiApiKey) {
      throw new Error('OpenAI API key is not configured. Set OPENAI_API_KEY environment variable.');
    }

    const prompt = `Based on the following Java classes summary, generate a comprehensive ARCHITECTURE DESIGN document that focuses on:

1. **Service Architecture Overview**
   - High-level system architecture diagram using PlantUML
   - External system connections and integrations
   - Component interaction overview
   - Technology stack and frameworks used

2. **Component Description**
   - Detailed description of each architectural component
   - Responsibility and role of each component
   - How components interact with each other
   - External dependencies and integrations

3. **Infrastructure Architecture**
   - Deployment architecture
   - Database architecture
   - Security architecture
   - Network architecture

4. **System Context**
   - External systems and their interfaces
   - Data flow between systems
   - Authentication and authorization flows at system level

Here is the classes summary JSON:

\`\`\`json
${JSON.stringify(classesSummary, null, 2)}
\`\`\`

Please generate this as a ${outputFormat.toUpperCase()} document with:
- Clear architectural diagrams using PlantUML
- Professional architecture documentation style
- Focus on high-level system design
- Component interaction diagrams
- External system integration diagrams

Make it suitable for architects and senior developers to understand the overall system design.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.openaiModel,
        messages: [
          {
            role: 'system',
            content: `You are an expert software architect specializing in Java Spring Boot applications. Generate comprehensive architecture design documentation in ${outputFormat} format with PlantUML diagrams.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 4000,
        temperature: 0.3,
      });

      const generatedContent = response.choices[0]?.message?.content;
      if (!generatedContent) {
        throw new Error('OpenAI returned empty response');
      }

      this.logInfo(`Successfully generated ${generatedContent.length} characters of architecture design documentation`);
      return generatedContent;

    } catch (error) {
      this.logError('OpenAI API call failed for architecture design', error);
      throw new Error(`Failed to generate architecture design: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async generateDetailedDesign(classesSummary: ClassSummary[], outputFormat: string): Promise<string> {
    this.logInfo(`Generating Detailed Design using OpenAI model: ${this.config.openaiModel}`);

    if (!this.config.openaiApiKey) {
      throw new Error('OpenAI API key is not configured. Set OPENAI_API_KEY environment variable.');
    }

    const prompt = `Based on the following Java classes summary, generate a comprehensive DETAILED DESIGN document that includes:

1. **Class-by-Class Analysis**
   - Detailed explanation of each class and its purpose
   - Methods and their functionality
   - Annotations and their significance
   - Design patterns used

2. **Runtime View Diagrams**
   - Sequence diagrams for key business flows using PlantUML
   - User registration flow
   - Authentication/login flow
   - JWT token validation flow
   - Key business process flows
   - Exception handling flows

3. **Entity Relationship Diagram**
   - Database schema with proper entity relationships using PlantUML
   - Entity attributes and relationships
   - Foreign key relationships
   - Database constraints and indexes

4. **Detailed Component Interactions**
   - Controller-Service-Repository interactions
   - Data flow through layers
   - Exception propagation
   - Transaction boundaries

Here is the classes summary JSON:

\`\`\`json
${JSON.stringify(classesSummary, null, 2)}
\`\`\`

Please generate this as a ${outputFormat.toUpperCase()} document with:
- Detailed PlantUML sequence diagrams
- Comprehensive class documentation
- Entity relationship diagrams
- Code-level design explanations

Make it suitable for developers to understand the detailed implementation design.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.openaiModel,
        messages: [
          {
            role: 'system',
            content: `You are an expert software engineer specializing in Java Spring Boot detailed design documentation. Generate comprehensive detailed design documentation in ${outputFormat} format with PlantUML diagrams.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 4000,
        temperature: 0.3,
      });

      const generatedContent = response.choices[0]?.message?.content;
      if (!generatedContent) {
        throw new Error('OpenAI returned empty response');
      }

      this.logInfo(`Successfully generated ${generatedContent.length} characters of detailed design documentation`);
      return generatedContent;

    } catch (error) {
      this.logError('OpenAI API call failed for detailed design', error);
      throw new Error(`Failed to generate detailed design: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async generateOpenApiSpecification(classesSummary: ClassSummary[], outputFormat: string): Promise<string> {
    this.logInfo(`Generating OpenAPI Specification using OpenAI model: ${this.config.openaiModel}`);

    if (!this.config.openaiApiKey) {
      throw new Error('OpenAI API key is not configured. Set OPENAI_API_KEY environment variable.');
    }

    // Extract REST controllers and their endpoints
    const restControllers = classesSummary.filter(cls => cls.isRestController);

    const prompt = `Based on the following Java REST controller classes, generate a comprehensive OpenAPI Specification document that includes:

1. **Introduction Section**
   - Brief overview of the API
   - Authentication requirements
   - Base URL and versioning
   - How to use this specification

2. **Complete OpenAPI 3.0 YAML Specification**
   - All REST endpoints with their HTTP methods
   - Request/response schemas
   - Path parameters and query parameters
   - Request body specifications
   - Response body specifications with status codes
   - Authentication/security requirements
   - Error response schemas

3. **API Documentation**
   - Endpoint descriptions and usage examples
   - Authentication flows
   - Common error codes and their meanings
   - Rate limiting information (if applicable)

Here are the REST Controller classes:

\`\`\`json
${JSON.stringify(restControllers, null, 2)}
\`\`\`

All classes for context:

\`\`\`json
${JSON.stringify(classesSummary, null, 2)}
\`\`\`

Please generate this as a ${outputFormat.toUpperCase()} document with:
- A complete, valid OpenAPI 3.0 YAML specification
- Detailed endpoint documentation
- Request/response examples
- Proper schema definitions

The YAML should be production-ready and importable into tools like Swagger UI, Postman, or Insomnia.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.openaiModel,
        messages: [
          {
            role: 'system',
            content: `You are an expert API documentation specialist. Generate comprehensive OpenAPI 3.0 specifications in ${outputFormat} format with complete YAML specifications and documentation.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 4000,
        temperature: 0.3,
      });

      const generatedContent = response.choices[0]?.message?.content;
      if (!generatedContent) {
        throw new Error('OpenAI returned empty response');
      }

      this.logInfo(`Successfully generated ${generatedContent.length} characters of OpenAPI specification documentation`);
      return generatedContent;

    } catch (error) {
      this.logError('OpenAI API call failed for OpenAPI specification', error);
      throw new Error(`Failed to generate OpenAPI specification: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logInfo('🚀 Java Documentation MCP Server running on stdio');

    // Auto-run pipeline if configured
    if (this.config.autoRunPipeline && this.config.microservicePath) {
      try {
        this.logInfo('🔄 Auto-running documentation pipeline...');
        await this.fullPipeline({});
        this.logInfo('✅ Auto-run pipeline completed successfully');
      } catch (error) {
        this.logError('❌ Auto-run pipeline failed', error);
      }
    }
  }
}

// Main execution
async function main() {
  console.error('🔧 Starting AutoDoc.AI MCP Server...');
  console.error(`📍 Current directory: ${process.cwd()}`);
  console.error(`🐛 Node version: ${process.version}`);
  
  const server = new JavaDocumentationMCPServer();
  console.error('✅ Server instance created');
  console.error('🚀 Sucessfully launched MCP server');
  
  await server.run();
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.error('🛑 Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('🛑 Received SIGTERM, shutting down...');
  process.exit(0);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Server error:', error);
    process.exit(1);
  });
}