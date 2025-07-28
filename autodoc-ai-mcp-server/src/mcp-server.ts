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
import crypto from 'crypto';

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

// Cache metadata interface
interface CacheMetadata {
  sourceHash: string;
  lastUpdated: string;
  sourceFiles: string[];
  classCount: number;
}

class JavaDocumentationMCPServer {
  private server: Server;
  private openai: OpenAI;
  private config: ServerConfig;

  constructor() {
    // Load configuration from environment variables
    this.config = {
      openaiApiKey: process.env.OPENAI_API_KEY || '',
      openaiModel: process.env.OPENAI_MODEL || 'gpt-4-turbo',
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
      baseURL: 'https://openrouter.ai/api/v1',
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
          description: 'Analyze Java project structure and generate/update classes-summary.json (with smart caching)',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Java project directory (optional, uses env MICROSERVICE_PATH if not provided)',
              },
              forceRegenerate: {
                type: 'boolean',
                description: 'Force regeneration even if source files haven\'t changed (default: false)',
              },
            },
            required: [],
          },
        },
        {
          name: 'generate_documentation',
          description: 'Generate comprehensive documentation from classes-summary.json using OpenAI (only if recently updated)',
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
              forceRegenerate: {
                type: 'boolean',
                description: 'Force documentation regeneration even if classes-summary.json is old (default: false)',
              },
            },
            required: [],
          },
        },
        {
          name: 'full_pipeline',
          description: 'Complete pipeline: analyze Java project and generate documentation (with smart caching)',
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
              forceRegenerate: {
                type: 'boolean',
                description: 'Force complete regeneration ignoring cache (default: false)',
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
        {
          name: 'get_cache_status',
          description: 'Get current cache status and metadata',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Java project directory (optional, uses env MICROSERVICE_PATH)',
              },
            },
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

        let result: CallToolResult;
        switch (request.params.name) {
          case 'analyze_java_project':
            result = await this.analyzeJavaProject(request.params.arguments);
            break;
          case 'generate_documentation':
            result = await this.generateDocumentation(request.params.arguments);
            break;
          case 'full_pipeline':
            result = await this.fullPipeline(request.params.arguments);
            break;
          case 'get_config':
            result = await this.getConfig();
            break;
          case 'get_cache_status':
            result = await this.getCacheStatus(request.params.arguments);
            break;
          default:
            const availableTools = ['analyze_java_project', 'generate_documentation', 'full_pipeline', 'get_config', 'get_cache_status'];
            this.logError(`Unknown tool requested: ${request.params.name}. Available tools: ${availableTools.join(', ')}`);
            result = {
              content: [
                {
                  type: 'text',
                  text: `❌ Error: Unknown tool: ${request.params.name}\n\n💡 Available tools:\n${availableTools.map(tool => `- ${tool}`).join('\n')}\n\n💡 **Troubleshooting Tips:**\n- Check that your project path exists and contains source files\n- Verify your OpenAI API key is valid and starts with "sk-"\n- Ensure you have write permissions to the output directory\n- For Java projects, make sure you have .java files in src/ directories\n- Check that your OpenAI account has available credits`,
                },
              ],
              isError: true,
            } satisfies CallToolResult;
        }

        // If EXIT_ON_TOOL_COMPLETE is set, exit after handling the tool call
        if (process.env.EXIT_ON_TOOL_COMPLETE === 'true') {
          this.logInfo('Shutting down MCP server...');
          // Give the launcher a moment to read the output before exiting
          setTimeout(() => process.exit(0), 250);
        }

        return result;
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

  private async getCacheStatus(args: any): Promise<CallToolResult> {
    const projectPath = args?.projectPath || this.config.microservicePath;
    
    if (!projectPath) {
      throw new Error('projectPath is required (either as parameter or MICROSERVICE_PATH env var)');
    }

    const classesSummaryPath = path.join(this.config.outputPath, 'classes-summary.json');
    const cacheMetadataPath = path.join(this.config.outputPath, '.cache-metadata.json');
    
    try {
      const currentSourceHash = await this.calculateSourceHash(projectPath);
      
      let cacheStatus = {
        classesSummaryExists: false,
        cacheMetadataExists: false,
        sourceFilesChanged: true,
        lastUpdated: 'Never',
        currentSourceHash,
        cachedSourceHash: 'N/A',
        sourceFileCount: 0,
        classCount: 0,
      };

      // Check if classes-summary.json exists
      try {
        await fs.access(classesSummaryPath);
        cacheStatus.classesSummaryExists = true;
      } catch {}

      // Check cache metadata
      try {
        const metadataContent = await fs.readFile(cacheMetadataPath, 'utf-8');
        const metadata: CacheMetadata = JSON.parse(metadataContent);
        cacheStatus.cacheMetadataExists = true;
        cacheStatus.cachedSourceHash = metadata.sourceHash;
        cacheStatus.lastUpdated = metadata.lastUpdated;
        cacheStatus.sourceFilesChanged = metadata.sourceHash !== currentSourceHash;
        cacheStatus.classCount = metadata.classCount;
      } catch {}

      // Count current source files
      const javaFiles = await this.findJavaFiles(projectPath);
      cacheStatus.sourceFileCount = javaFiles.length;

      return {
        content: [
          {
            type: 'text',
            text: `📊 Cache Status Report:\n\n` +
                  `📁 Classes Summary Exists: ${cacheStatus.classesSummaryExists ? '✅' : '❌'}\n` +
                  `🗂️  Cache Metadata Exists: ${cacheStatus.cacheMetadataExists ? '✅' : '❌'}\n` +
                  `🔄 Source Files Changed: ${cacheStatus.sourceFilesChanged ? '🔄 YES (regeneration needed)' : '✅ NO (cache valid)'}\n` +
                  `📅 Last Updated: ${cacheStatus.lastUpdated}\n` +
                  `📝 Source Files Found: ${cacheStatus.sourceFileCount}\n` +
                  `📋 Classes in Cache: ${cacheStatus.classCount}\n\n` +
                  `🔍 Hash Comparison:\n` +
                  `   Current:  ${cacheStatus.currentSourceHash}\n` +
                  `   Cached:   ${cacheStatus.cachedSourceHash}\n\n` +
                  `💡 Recommendation: ${cacheStatus.sourceFilesChanged ? 
                    '🔄 Run analyze_java_project to update cache' : 
                    '✅ Cache is up-to-date, no action needed'}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get cache status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async calculateSourceHash(projectPath: string): Promise<string> {
    const javaFiles = await this.findJavaFiles(projectPath);
    
    if (javaFiles.length === 0) {
      return 'empty';
    }

    // Sort files for consistent hashing
    javaFiles.sort();
    
    const hash = crypto.createHash('sha256');
    
    for (const filePath of javaFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const stats = await fs.stat(filePath);
        
        // Include file path, content, and modification time in hash
        hash.update(`${filePath}:${stats.mtime.toISOString()}:${content}`);
      } catch (error) {
        this.logError(`Failed to read file for hashing: ${filePath}`, error);
      }
    }
    
    return hash.digest('hex');
  }

  private async shouldRegenerateClassesSummary(projectPath: string, forceRegenerate: boolean = false): Promise<boolean> {
    if (forceRegenerate) {
      this.logInfo('🔄 Force regeneration requested');
      return true;
    }

    const classesSummaryPath = path.join(this.config.outputPath, 'classes-summary.json');
    const cacheMetadataPath = path.join(this.config.outputPath, '.cache-metadata.json');

    try {
      // Check if classes summary exists
      await fs.access(classesSummaryPath);
      
      // Check if cache metadata exists
      await fs.access(cacheMetadataPath);
      
      // Read cache metadata
      const metadataContent = await fs.readFile(cacheMetadataPath, 'utf-8');
      const metadata: CacheMetadata = JSON.parse(metadataContent);
      
      // Calculate current source hash
      const currentSourceHash = await this.calculateSourceHash(projectPath);
      
      if (metadata.sourceHash === currentSourceHash) {
        this.logInfo('✅ Source files unchanged, using cached classes-summary.json');
        return false;
      } else {
        this.logInfo('🔄 Source files changed, regeneration needed');
        this.logDebug('Hash comparison:', {
          cached: metadata.sourceHash,
          current: currentSourceHash
        });
        return true;
      }
    } catch (error) {
      this.logInfo('📄 No valid cache found, will generate classes-summary.json');
      return true;
    }
  }

  private async saveCacheMetadata(projectPath: string, classesSummary: ClassSummary[]): Promise<void> {
    const sourceHash = await this.calculateSourceHash(projectPath);
    const javaFiles = await this.findJavaFiles(projectPath);
    
    const metadata: CacheMetadata = {
      sourceHash,
      lastUpdated: new Date().toISOString(),
      sourceFiles: javaFiles.sort(),
      classCount: classesSummary.length,
    };

    const cacheMetadataPath = path.join(this.config.outputPath, '.cache-metadata.json');
    await fs.writeFile(cacheMetadataPath, JSON.stringify(metadata, null, 2));
    
    this.logDebug('💾 Cache metadata saved:', metadata);
  }

  private async shouldRegenerateDocumentation(forceRegenerate: boolean = false, classesSummaryWasRegenerated: boolean = false): Promise<boolean> {
    if (forceRegenerate) {
      this.logInfo('🔄 Force documentation regeneration requested');
      return true;
    }

    // If classes-summary.json was just regenerated, we definitely need to regenerate docs
    if (classesSummaryWasRegenerated) {
      this.logInfo('🔄 classes-summary.json was just regenerated, documentation needs update');
      return true;
    }

    const classesSummaryPath = path.join(this.config.outputPath, 'classes-summary.json');
    
    // Check if documentation files exist
    const docFiles = [
      path.join(this.config.outputPath, `architecturedesign.${this.config.docFormat}`),
      path.join(this.config.outputPath, `detaileddesign.${this.config.docFormat}`),
      path.join(this.config.outputPath, `openApiSpecification.${this.config.docFormat}`),
    ];

    try {
      // Check if all documentation files exist
      const missingFiles: string[] = [];
      for (const docFile of docFiles) {
        try {
          await fs.access(docFile);
        } catch {
          missingFiles.push(path.basename(docFile));
        }
      }

      if (missingFiles.length > 0) {
        this.logInfo(`📄 Missing documentation files: ${missingFiles.join(', ')}, will generate documentation`);
        return true;
      }

      // Get classes-summary.json modification time
      const summaryStats = await fs.stat(classesSummaryPath);
      
      // Get the oldest documentation file time
      let oldestDocTime = new Date();
      let oldestDocFile = '';
      for (const docFile of docFiles) {
        const docStats = await fs.stat(docFile);
        if (docStats.mtime < oldestDocTime) {
          oldestDocTime = docStats.mtime;
          oldestDocFile = path.basename(docFile);
        }
      }

      // Log detailed timestamp information
      // this.logInfo('🕒 Timestamp comparison details:');
      // this.logInfo(`   classes-summary.json: ${summaryStats.mtime.toISOString()}`);
      // this.logInfo(`   Oldest doc file (${oldestDocFile}): ${oldestDocTime.toISOString()}`);
      // this.logInfo(`   Time difference: ${summaryStats.mtime.getTime() - oldestDocTime.getTime()}ms`);

      // If classes-summary.json is newer than documentation files, regenerate
      if (summaryStats.mtime > oldestDocTime) {
        this.logInfo('🔄 classes-summary.json is newer than documentation, regeneration needed');
        return true;
      } else {
        this.logInfo('\n✅ Documentation is up-to-date (No code changes detected since last generation)');
        return false;
      }
    } catch (error) {
      this.logError('📄 Error checking documentation status, will generate documentation', error);
      return true;
    }
  }

  private async analyzeJavaProject(args: any): Promise<CallToolResult> {
    const projectPath = args?.projectPath || this.config.microservicePath;
    const forceRegenerate = args?.forceRegenerate || false;
    
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

    // Ensure output directory exists
    await fs.mkdir(this.config.outputPath, { recursive: true });

    // Check if regeneration is needed
    const shouldRegenerate = await this.shouldRegenerateClassesSummary(projectPath, forceRegenerate);
    
    if (!shouldRegenerate) {
      const classesSummaryPath = path.join(this.config.outputPath, 'classes-summary.json');
      const content = await fs.readFile(classesSummaryPath, 'utf-8');
      const classesSummary = JSON.parse(content);
      
      return {
        content: [
          {
            type: 'text',
            text: `✅ Using cached classes-summary.json (no source changes detected)\n\n📊 Cached analysis contains ${classesSummary.length} classes:\n${classesSummary.map((c: ClassSummary) => `- ${c.className}`).join('\n')}\n\n💡 Use forceRegenerate=true to regenerate anyway`,
          },
        ],
      };
    }
    
    const classesSummary = await this.parseJavaFiles(projectPath);
    
    if (classesSummary.length === 0) {
      throw new Error(`No Java classes found in project path: ${projectPath}. Make sure the path contains .java files.`);
    }
    
    const outputPath = path.join(this.config.outputPath, 'classes-summary.json');
    await fs.writeFile(outputPath, JSON.stringify(classesSummary, null, 2));
    
    // Save cache metadata
    await this.saveCacheMetadata(projectPath, classesSummary);

    this.logInfo(`📄 Classes summary generated: ${outputPath}`);

    return {
      content: [
        {
          type: 'text',
          text: `✅ Successfully analyzed Java project and generated classes-summary.json at ${outputPath}\n\n📊 Found ${classesSummary.length} classes:\n${classesSummary.map(c => `- ${c.className}`).join('\n')}\n\n💾 Cache metadata saved for future runs`,
        },
      ],
    };
  }

  private async generateDocumentation(args: any): Promise<CallToolResult> {
    const classesSummaryPath = args?.classesSummaryPath || path.join(this.config.outputPath, 'classes-summary.json');
    const outputFormat = args?.outputFormat || this.config.docFormat;
    const outputDir = args?.outputDir || this.config.outputPath;
    const forceRegenerate = args?.forceRegenerate || false;
    
    this.logInfo(`📝 Generating documentation from: ${classesSummaryPath}`);
    
    // Check if classes summary file exists
    try {
      await fs.access(classesSummaryPath);
    } catch (error) {
      throw new Error(`Classes summary file not found: ${classesSummaryPath}. Run analyze_java_project first.`);
    }

    // Check if documentation regeneration is needed
    const shouldRegenerate = await this.shouldRegenerateDocumentation(forceRegenerate, false);
    
    if (!shouldRegenerate) {
      const docFiles = [
        `architecturedesign.${outputFormat}`,
        `detaileddesign.${outputFormat}`,
        `openApiSpecification.${outputFormat}`,
      ];
      
      return {
        content: [
          {
            type: 'text',
            text: `✅ Documentation is up-to-date (classes-summary.json hasn't changed)\n\n📚 Existing documentation files:\n${docFiles.map(file => `- ${file}`).join('\n')}\n\n💡 Use forceRegenerate=true to regenerate anyway`,
          },
        ],
      };
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
          text: `✅ Successfully generated ${outputFormat.toUpperCase()} documentation files:\n${generatedFiles.map(file => `- ${path.basename(file)}`).join('\n')}\n\n🔄 Documentation was regenerated because classes-summary.json was recently updated`,
        },
      ],
    };
  }

  private async fullPipeline(args: any): Promise<CallToolResult> {
    const projectPath = args?.projectPath || this.config.microservicePath;
    const outputDir = args?.outputDir || this.config.outputPath;
    const outputFormat = args?.outputFormat || this.config.docFormat;
    const forceRegenerate = args?.forceRegenerate || false;
    
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

    let pipelineResults: string[] = [];

    // Step 1: Check if classes-summary.json needs regeneration
    this.logInfo('📋 Step 1: Checking if classes analysis is needed...');
    const shouldRegenerateClasses = await this.shouldRegenerateClassesSummary(projectPath, forceRegenerate);
    
    let classesSummary: ClassSummary[];
    let classesSummaryPath = path.join(outputDir, 'classes-summary.json');
    
    if (shouldRegenerateClasses) {
      this.logInfo('🔄 Analyzing Java project (source files changed)...');
      classesSummary = await this.parseJavaFiles(projectPath);
      
      if (classesSummary.length === 0) {
        throw new Error(`No Java classes found in project path: ${projectPath}. Make sure the path contains .java files in src/ directories.`);
      }
      
      await fs.writeFile(classesSummaryPath, JSON.stringify(classesSummary, null, 2));
      await this.saveCacheMetadata(projectPath, classesSummary);
      pipelineResults.push('🔄 Regenerated classes-summary.json (source files changed)');
    } else {
      this.logInfo('✅ Using cached classes-summary.json (no source changes)');
      const content = await fs.readFile(classesSummaryPath, 'utf-8');
      classesSummary = JSON.parse(content);
      pipelineResults.push('✅ Used cached classes-summary.json (no changes)');
    }

    // Step 2: Check if documentation needs regeneration
    this.logInfo('📝 Step 2: Checking if documentation regeneration is needed...');
    const shouldRegenerateDoc = await this.shouldRegenerateDocumentation(forceRegenerate, shouldRegenerateClasses);
    
    if (shouldRegenerateDoc) {
      this.logInfo('🤖 Generating documentation with OpenAI...');
      
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

      pipelineResults.push(`🔄 Generated ${generatedFiles.length} documentation files`);
      pipelineResults.push(`📁 Files: ${generatedFiles.map(f => path.basename(f)).join(', ')}`);
    } else {
      this.logInfo('✅ Skipping document generation');
      pipelineResults.push('✅ Documentation is up-to-date (skipped regeneration)');
    }

    this.logInfo('\n✅ Full pipeline completed successfully');

    return {
      content: [
        {
          type: 'text',
          text: `🎉 Full pipeline completed successfully!\n\n`,
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
        const methodMatch = content.match(new RegExp(mapping.replace(/[.*+?^${}()|[\]\\]/g, '\\  private async parseJavaFiles(projectPath: string): Promise<ClassSummary[]') + '.*?public.*?(\\w+)\\s*\\('));
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
  console.error('\n🔧 Starting AutoDoc.AI MCP Server...');
  console.info(`📍 Current directory: ${process.cwd()}`);
  console.info(`🐛 Node version: ${process.version}`);
  
  const server = new JavaDocumentationMCPServer();
  console.info('✅ Server instance created');
  console.info('🚀 Sucessfully launched MCP server');
  
  await server.run();
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.info('🛑 Shutting down...');
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