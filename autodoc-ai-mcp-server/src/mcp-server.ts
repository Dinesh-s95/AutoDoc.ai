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
import { spawn } from 'child_process';
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
  // Jira configuration
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
}

// Cache metadata interface
interface CacheMetadata {
  sourceHash: string;
  lastUpdated: string;
  sourceFiles: string[];
  classCount: number;
}

// Jira issue interface
interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: any;
    status: {
      name: string;
    };
    issuetype: {
      name: string;
    };
    created: string;
    updated: string;
  };
}

// Git commit info interface
interface GitCommitInfo {
  hash: string;
  message: string;
  ticketNumber?: string;
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
      // Jira configuration
      jiraBaseUrl: process.env.JIRA_BASE_URL || '',
      jiraEmail: process.env.JIRA_EMAIL || '',
      jiraApiToken: process.env.JIRA_API_TOKEN || '',
    };

    this.server = new Server(
      {
        name: 'java-documentation-server',
        version: '2.1.0',
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
      jiraConfigured: !!(this.config.jiraBaseUrl && this.config.jiraEmail && this.config.jiraApiToken),
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
    // Handle Error objects specially to extract useful information
    if (data instanceof Error) {
      this.log('error', message, {
        errorMessage: data.message,
        stack: data.stack?.split('\n'),
        name: data.name
      });
    } else if (data !== undefined) {
      // For non-Error objects, try to ensure they're loggable
      this.log('error', message, 
        typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : String(data)
      );
    } else {
      this.log('error', message);
    }
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
          name: 'generate_release_notes',
          description: 'Generate release notes based on the last commit with Jira ticket number (format: TICKET-123 commit message)',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the git repository (optional, uses env MICROSERVICE_PATH if not provided)',
              },
              outputDir: {
                type: 'string',
                description: 'Directory to save release notes (optional, uses env OUTPUT_PATH/release-notes)',
              },
              branch: {
                type: 'string',
                description: 'Git branch to check for commits (default: current branch)',
              },
            },
            required: [],
          },
        },
        {
          name: 'full_pipeline',
          description: 'Complete pipeline: analyze Java project, generate documentation, and create release notes (with smart caching)',
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
              generateReleaseNotes: {
                type: 'boolean',
                description: 'Whether to generate release notes (default: true)',
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
          case 'generate_release_notes':
            result = await this.generateReleaseNotes(request.params.arguments);
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
            const availableTools = ['analyze_java_project', 'generate_documentation', 'generate_release_notes', 'full_pipeline', 'get_config', 'get_cache_status'];
            this.logError(`Unknown tool requested: ${request.params.name}. Available tools: ${availableTools.join(', ')}`);
            result = {
              content: [
                {
                  type: 'text',
                  text: `❌ Error: Unknown tool: ${request.params.name}\n\n💡 Available tools:\n${availableTools.map(tool => `- ${tool}`).join('\n')}\n\n💡 **Troubleshooting Tips:**\n- Check that your project path exists and contains source files\n- Verify your OpenAI API key is valid and starts with "sk-"\n- Ensure you have write permissions to the output directory\n- For Java projects, make sure you have .java files in src/ directories\n- Check that your OpenAI account has available credits\n- For Jira integration, ensure JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN are set`,
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
              text: `❌ Error executing ${request.params.name}: ${error instanceof Error ? error.message : String(error)}\n\n💡 **Troubleshooting Tips:**\n- Check that your project path exists and contains source files\n- Verify your OpenAI API key is valid and starts with "sk-"\n- Ensure you have write permissions to the output directory\n- For Java projects, make sure you have .java files in src/ directories\n- Check that your OpenAI account has available credits\n- For Jira integration, ensure JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN are set`,
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
      jiraApiToken: this.config.jiraApiToken ? '***CONFIGURED***' : '***NOT SET***',
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
                  `🔄 Java Files Changed: ${cacheStatus.sourceFilesChanged ? '🔄 YES (regeneration needed)' : '✅ NO (cache valid)'}\n` +
                  `📅 Last Updated: ${cacheStatus.lastUpdated}\n` +
                  `📝 Java Files Found: ${cacheStatus.sourceFileCount}\n` +
                  `📋 Classes in Cache: ${cacheStatus.classCount}\n\n` +
                  `🔍 Hash Comparison (Java files only):\n` +
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

  private async getLastCommitFromBranch(projectPath: string, branch?: string): Promise<GitCommitInfo> {
    // Get the commit information in a single command
    return new Promise((resolve, reject) => {
      const gitArgs = ['log', '-1', '--pretty=format:%H|%s', ...(branch ? [branch] : [])];

      this.logDebug(`Executing git command: git ${gitArgs.join(' ')} in ${projectPath}`);

      const git = spawn('git', gitArgs, { 
        cwd: projectPath,
        stdio: 'pipe'
      });

      let output = '';
      let error = '';

      git.stdout.on('data', (data) => {
        output += data.toString();
      });

      git.stderr.on('data', (data) => {
        error += data.toString();
      });

      git.on('close', (code) => {
        this.logDebug(`Git command finished with code ${code}, output: "${output.trim()}", error: "${error.trim()}"`);
        
        if (code !== 0) {
          const errorMessage = error.trim() || `Git command failed with exit code ${code}`;
          this.logError(`Git command failed with code ${code}: ${errorMessage}`);
          reject(new Error(`Git command failed with code ${code}: ${errorMessage}`));
          return;
        }

        if (!output.trim()) {
          this.logError('Git command returned empty output - no commits found');
          reject(new Error('No commits found in the repository'));
          return;
        }

        const parts = output.trim().split('|');
        if (parts.length < 2) {
          this.logError(`Invalid git output format: "${output.trim()}"`);
          reject(new Error(`Invalid git log output format: "${output.trim()}"`));
          return;
        }

        const [hash, message] = parts;
        
        this.logDebug(`Parsed commit: hash="${hash}", message="${message}"`);
        
        // Extract ticket number from commit message (format: TICKET-123 commit message)
        const ticketMatch = message.match(/^([A-Z]+[-_][0-9]+)/);
        const ticketNumber = ticketMatch ? ticketMatch[1].replace('_', '-') : undefined;
        
        this.logDebug(`Extracted ticket number: ${ticketNumber || 'none'}`);

        resolve({
          hash,
          message,
          ticketNumber
        });
      });

      git.on('error', (err) => {
        this.logError(`Failed to execute git command: ${err.message}`, err);
        reject(new Error(`Failed to execute git command: ${err.message}`));
      });
    });
  }

  private async fetchJiraIssue(ticketNumber: string): Promise<JiraIssue> {
    if (!this.config.jiraBaseUrl || !this.config.jiraEmail || !this.config.jiraApiToken) {
      throw new Error('Jira configuration missing. Please set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables.');
    }

    const auth = Buffer.from(`${this.config.jiraEmail}:${this.config.jiraApiToken}`).toString('base64');
    
    try {
      const response = await fetch(`${this.config.jiraBaseUrl}/rest/api/3/issue/${ticketNumber}`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Jira ticket ${ticketNumber} not found`);
        } else if (response.status === 401) {
          throw new Error('Jira authentication failed. Please check your credentials.');
        } else {
          throw new Error(`Jira API error: ${response.status} ${response.statusText}`);
        }
      }

      const issue = await response.json() as JiraIssue;
      return issue;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to fetch Jira issue: ${String(error)}`);
    }
  }

  private getCurrentQuarter(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // getMonth() returns 0-11
    const quarter = Math.ceil(month / 3);
    return `${year}.${quarter}`;
  }

  private async generateReleaseNotes(args: any): Promise<CallToolResult> {
    // Use the root directory (proto-calls-autodoc) for Git operations and release notes
    const gitRepoPath = path.join(process.cwd(), '..');
    const outputDir = args?.outputDir || path.join(gitRepoPath, 'release-notes');
    const branch = args?.branch || 'testJiraIntegration';

    try {
      // Check if .git directory exists in the root repository
      try {
        await fs.access(path.join(gitRepoPath, '.git'));
        this.logDebug('Git repository detected');
      } catch (error) {
        throw new Error(`Root directory is not a git repository: ${gitRepoPath}`);
      }

      this.logInfo(`🏷️  Generating release notes in root directory: ${gitRepoPath}`);

      // Get the last commit information from the root repository
      this.logDebug('Fetching last commit information...');
      const commitInfo = await this.getLastCommitFromBranch(gitRepoPath, branch);
      this.logInfo(`📝 Last commit: ${commitInfo.hash.substring(0, 8)} - ${commitInfo.message}`);

      if (!commitInfo.ticketNumber) {
        return {
          content: [
            {
              type: 'text',
              text: `⚠️  No Jira ticket number found in the last commit message.\n\nCommit: ${commitInfo.hash.substring(0, 8)} - "${commitInfo.message}"\n\n💡 Expected format: "TICKET-123 your commit message" where TICKET-123 is your Jira ticket number.`,
            },
          ],
        };
      }

      this.logInfo(`🎫 Jira ticket found: ${commitInfo.ticketNumber}`);

      // Fetch Jira issue details
      try {
        const jiraIssue = await this.fetchJiraIssue(commitInfo.ticketNumber);
        this.logInfo(`📋 Fetched Jira issue: ${jiraIssue.key} - ${jiraIssue.fields.summary}`);

        // Create release-notes directory
        await fs.mkdir(outputDir, { recursive: true });

        // Generate release note content
        const release = this.getCurrentQuarter();
        const releaseNoteContent = `${jiraIssue.key} & ${jiraIssue.fields.summary} & ${release}`;

        // Save release note file
        const fileName = `${jiraIssue.key}.txt`;
        const filePath = path.join(outputDir, fileName);
        await fs.writeFile(filePath, releaseNoteContent);

        this.logInfo(`📄 Release note generated: ${filePath}`);

        return {
          content: [
            {
              type: 'text',
              text: `✅ Release note generated successfully!\n\n` +
                    `🎫 Jira Ticket: ${jiraIssue.key}\n` +
                    `📋 Title: ${jiraIssue.fields.summary}\n` +
                    `📅 Release: ${release}\n` +
                    `📁 File: ${fileName}\n` +
                    `📂 Location: ${filePath}\n\n` +
                    `📝 Content: ${releaseNoteContent}`,
            },
          ],
        };
      } catch (jiraError) {
        this.logError('Jira API call failed', jiraError);
        
        // Still generate a release note with commit info only
        const release = this.getCurrentQuarter();
        const releaseNoteContent = `${commitInfo.ticketNumber} & ${commitInfo.message} & ${release}`;
        
        await fs.mkdir(outputDir, { recursive: true });
        const fileName = `${commitInfo.ticketNumber}.txt`;
        const filePath = path.join(outputDir, fileName);
        await fs.writeFile(filePath, releaseNoteContent);

        return {
          content: [
            {
              type: 'text',
              text: `⚠️  Release note generated with limited info (Jira fetch failed)\n\n` +
                    `🎫 Ticket: ${commitInfo.ticketNumber}\n` +
                    `📝 Commit: ${commitInfo.message}\n` +
                    `📅 Release: ${release}\n` +
                    `📁 File: ${fileName}\n` +
                    `📂 Location: ${filePath}\n\n` +
                    `❌ Jira Error: ${jiraError instanceof Error ? jiraError.message : String(jiraError)}\n` +
                    `📝 Content: ${releaseNoteContent}`,
            },
          ],
        };
      }

    } catch (error) {
      this.logError('Release notes generation failed', error);
      
      // Provide more specific error messages based on the type of error
      let errorMessage = '';
      if (error instanceof Error) {
        if (error.message.includes('not a git repository')) {
          errorMessage = `Directory is not a git repository: ${gitRepoPath}`;
        } else if (error.message.includes('No commits found')) {
          errorMessage = 'No commits found in the repository';
        } else if (error.message.includes('Git command failed')) {
          errorMessage = `Git error: ${error.message}`;
        } else {
          errorMessage = error.message;
        }
      } else {
        errorMessage = String(error);
      }
      
      throw new Error(`Failed to generate release notes: ${errorMessage}`);
    }
  }
  // Existing methods (calculateSourceHash, shouldRegenerateClassesSummary, etc.) remain the same...
  
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
        
        // Only hash the content of Java files, ignore metadata like modification time
        // This ensures only actual Java code changes trigger regeneration
        const relativePath = path.relative(projectPath, filePath);
        hash.update(`${relativePath}:${content}`);
        
        this.logDebug(`Hashing Java file: ${relativePath}`);
      } catch (error) {
        this.logError(`Failed to read Java file for hashing: ${filePath}`, error);
      }
    }
    
    const finalHash = hash.digest('hex');
    this.logDebug(`Calculated source hash for ${javaFiles.length} Java files: ${finalHash}`);
    return finalHash;
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
      
      // Calculate current source hash (only considers Java files)
      const currentSourceHash = await this.calculateSourceHash(projectPath);
      
      // Get current Java files for comparison
      const currentJavaFiles = await this.findJavaFiles(projectPath);
      const currentRelativeFiles = currentJavaFiles.map(file => path.relative(projectPath, file)).sort();
      
      // Check if Java files have changed
      const filesChanged = JSON.stringify(metadata.sourceFiles) !== JSON.stringify(currentRelativeFiles);
      const contentChanged = metadata.sourceHash !== currentSourceHash;
      
      if (!filesChanged && !contentChanged) {
        this.logInfo('✅ No Java file changes detected, using cached classes-summary.json');
        this.logDebug(`Java files: ${currentJavaFiles.length}, Hash: ${currentSourceHash}`);
        return false;
      } else {
        if (filesChanged) {
          this.logInfo('🔄 Java file structure changed, regeneration needed');
          this.logDebug('File structure changes:', {
            before: metadata.sourceFiles.length,
            after: currentRelativeFiles.length,
            added: currentRelativeFiles.filter(f => !metadata.sourceFiles.includes(f)),
            removed: metadata.sourceFiles.filter(f => !currentRelativeFiles.includes(f))
          });
        }
        if (contentChanged) {
          this.logInfo('🔄 Java file content changed, regeneration needed');
          this.logDebug('Hash comparison:', {
            cached: metadata.sourceHash,
            current: currentSourceHash
          });
        }
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
      sourceFiles: javaFiles.map(file => path.relative(projectPath, file)).sort(), // Store relative paths
      classCount: classesSummary.length,
    };

    const cacheMetadataPath = path.join(this.config.outputPath, '.cache-metadata.json');
    await fs.writeFile(cacheMetadataPath, JSON.stringify(metadata, null, 2));
    
    this.logInfo(`💾 Cache metadata saved: ${metadata.classCount} classes from ${metadata.sourceFiles.length} Java files`);
    this.logDebug('💾 Cached Java files:', metadata.sourceFiles);
  }

  private async shouldRegenerateDocumentation(forceRegenerate: boolean = false, classesSummaryWasRegenerated: boolean = false): Promise<boolean> {
    if (forceRegenerate) {
      this.logInfo('🔄 Force documentation regeneration requested');
      return true;
    }

    // If classes-summary.json was just regenerated due to code changes, regenerate docs
    if (classesSummaryWasRegenerated) {
      this.logInfo('🔄 Java code changed, documentation needs update');
      return true;
    }

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

      // If we reach here, all docs exist and classesSummaryWasRegenerated is false
      this.logInfo('\n✅ Documentation is up-to-date (No Java code changes detected since last generation)');
      return false;
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
            text: `✅ Using cached classes-summary.json (no Java file changes detected)\n\n📊 Cached analysis contains ${classesSummary.length} classes:\n${classesSummary.map((c: ClassSummary) => `- ${c.className}`).join('\n')}\n\n💡 Use forceRegenerate=true to regenerate anyway`,
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
    const generateReleaseNotes = args?.generateReleaseNotes !== false; // Default to true
    
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
      pipelineResults.push('🔄 Regenerated classes-summary.json (Java files changed)');
    } else {
      this.logInfo('✅ Using cached classes-summary.json (no Java file changes)');
      const content = await fs.readFile(classesSummaryPath, 'utf-8');
      classesSummary = JSON.parse(content);
      pipelineResults.push('✅ Used cached classes-summary.json (no Java changes)');
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

    // Step 3: Generate release notes if requested and Jira is configured
    // Step 3: Generate release notes if requested and Jira is configured
    if (generateReleaseNotes) {
      this.logInfo('🏷️  Step 3: Generating release notes...');
      try {
        const releaseNotesResult = await this.generateReleaseNotes({
          projectPath,
          outputDir: args?.releaseNotesPath || path.join(outputDir, 'release-notes')
        });
        
        // Extract success message from release notes result
        const releaseNotesText = releaseNotesResult.content[0]?.type === 'text' ? 
          releaseNotesResult.content[0].text : '';
        
        if (releaseNotesText.startsWith('✅')) {
          pipelineResults.push('🏷️  Generated release notes successfully');
          // Extract ticket info from the result
          const ticketMatch = releaseNotesText.match(/🎫 Jira Ticket: ([A-Z]+-\d+)/);
          if (ticketMatch) {
            pipelineResults.push(`📋 Ticket: ${ticketMatch[1]}`);
          }
        } else if (releaseNotesText.startsWith('⚠️')) {
          pipelineResults.push('⚠️  ' + releaseNotesText.split('\n')[0].replace('⚠️  ', ''));
        } else {
          pipelineResults.push('⚠️  Release notes: ' + releaseNotesText.split('\n')[0]);
        }
      } catch (error) {
        this.logError('Release notes generation failed', error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        
        // Categorize the error for better user feedback
        if (errorMsg.includes('not a git repository')) {
          pipelineResults.push('❌ Release notes failed: Not a git repository');
        } else if (errorMsg.includes('No commits found')) {
          pipelineResults.push('❌ Release notes failed: No commits found');
        } else if (errorMsg.includes('Jira configuration missing')) {
          pipelineResults.push('⚠️  Release notes skipped (Jira not configured)');
        } else if (errorMsg.includes('Git command failed')) {
          pipelineResults.push('❌ Release notes failed: Git error');
          this.logDebug(`Git error details: ${errorMsg}`);
        } else {
          pipelineResults.push(`❌ Release notes failed: ${errorMsg.split('\n')[0]}`);
        }
      }
    } else {
      pipelineResults.push('⏭️  Release notes generation skipped');
    }

    this.logInfo('\n✅ Full pipeline completed successfully');

    return {
      content: [
        {
          type: 'text',
          text: `🎉 Full pipeline completed successfully!\n\n📋 Pipeline Results:\n${pipelineResults.map(result => `- ${result}`).join('\n')}\n\n💡 Only Java file changes trigger regeneration - other files are ignored\n\n🔧 **Jira Integration:** ${this.config.jiraBaseUrl ? '✅ Configured' : '❌ Not configured (set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)'}`,
        },
      ],
    };
  }

  // All the existing parsing and documentation generation methods remain the same...
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
        
        if (entry.isDirectory() && !entry.name.startsWith('.') && 
            entry.name !== 'target' && entry.name !== 'build' && 
            entry.name !== 'node_modules' && entry.name !== 'dist') {
          const subFiles = await this.findJavaFiles(fullPath);
          javaFiles.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith('.java')) {
          // Only include .java files, explicitly ignore all other file types
          javaFiles.push(fullPath);
          this.logDebug(`Found Java file: ${fullPath}`);
        }
      }
    } catch (error) {
      this.logError(`Error reading directory: ${dir}`, error);
    }
    
    this.logDebug(`Total Java files found in ${dir}: ${javaFiles.length}`);
    return javaFiles;
  }

  private parseJavaClass(content: string): ClassSummary | null {
    const annotations: string[] = [];
    const methods: string[] = [];
    const endpoints: any[] = [];
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

    // Parse class-level @RequestMapping (base path)
    let basePath = '';
    const classMappingMatch = content.match(/@RequestMapping\(([^)]*)\)/);
    if (classMappingMatch) {
      const pathMatch = classMappingMatch[1].match(/value\s*=\s*"([^"]+)"|"([^"]+)"/);
      basePath = pathMatch ? (pathMatch[1] || pathMatch[2]) : '';
    }

    // Parse methods
    const methodRegex = /((?:@[\w]+(?:\([^)]*\))?\s*)*)(?:public|private|protected)\s+([\w<>?,\s\[\]]+)\s+(\w+)\s*\(([^)]*)\)(?:\s+throws\s+[\w,\s]+)?/g;
    let methodMatch;
    while ((methodMatch = methodRegex.exec(content)) !== null) {
      const annotationBlock = methodMatch[1];
      const returnType = methodMatch[2].trim();
      const methodName = methodMatch[3];
      const params = methodMatch[4];
      const methodSignature = content.substring(methodMatch.index, methodRegex.lastIndex).split('{')[0].trim();
      methods.push(methodSignature.replace(/\s+/g, ' '));

      // Find mapping annotation and path
      const mappingAnnotationMatch = annotationBlock.match(/@(GetMapping|PostMapping|PutMapping|DeleteMapping|RequestMapping)(\(([^)]*)\))?/);
      if (mappingAnnotationMatch) {
        const httpMethod = mappingAnnotationMatch[1];
        let methodPath = '';
        if (mappingAnnotationMatch[3]) {
          const pathMatch = mappingAnnotationMatch[3].match(/value\s*=\s*"([^"]+)"|"([^"]+)"/);
          methodPath = pathMatch ? (pathMatch[1] || pathMatch[2]) : '';
        }
        // Combine basePath and methodPath
        let url = '';
        if (basePath && methodPath) {
          url = `${basePath}${methodPath.startsWith('/') ? '' : '/'}${methodPath}`;
        } else if (basePath) {
          url = basePath;
        } else if (methodPath) {
          url = methodPath;
        }

        // Parse input parameters
        const inputs: any[] = [];
        if (params.trim()) {
          params.split(',').forEach(param => {
            const paramMatch = param.trim().match(/(@\w+)?\s*([\w<>\[\]]+)\s+(\w+)/);
            if (paramMatch) {
              inputs.push({
                annotation: paramMatch[1] ? paramMatch[1].replace('@', '') : '',
                type: paramMatch[2],
                name: paramMatch[3]
              });
            }
          });
        }

        endpoints.push({
          annotation: httpMethod,
          method: methodSignature.replace(/\s+/g, ' '),
          url,
          inputs,
          output: returnType
        });
      }
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

    return {
      className,
      annotations: annotations.sort(),
      methods: methods.sort(),
      endpoints,
      fields: fields.sort(),
      isEntity,
      isRestController,
    };
  }

  // All the existing OpenAI documentation generation methods remain the same...
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
   - Business process flows
   - Exception handling flows

3. **Entity Relationship Diagram**
   - Database schema with proper entity relationships using PlantUML
   - Entity attributes and relationships
   - Foreign key relationships
   - Database constraints and indexes

  After the PlantUML ER diagram, provide a detailed, human-readable description of the entities and their relationships as depicted in the diagram.

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
    
    const prompt = `You are given a list of Java classes extracted from a Spring Boot application, particularly REST controllers and their metadata. Based on this, generate a production-ready OpenAPI 3.0 specification in YAML format.

## Requirements:

1. **Overview Section**
   - API title and version
   - Base path (e.g., /idp)
   - Authentication method used (e.g., JWT Bearer token if present)
   - General usage guidance

2. **OpenAPI Specification**
   - For each REST controller:
     - Extract and document all HTTP endpoints from the methods
     - Use class names and method names to infer logical groupings and operation summaries
     - If annotations like '@RequestMapping', '@GetMapping', '@PostMapping' are present, derive the full endpoint paths and HTTP methods
   - Define request and response bodies using 'schemas'
     - Infer schema names from method parameters (e.g., 'Users')
     - Include example payloads when possible
   - Include response status codes (e.g., 200 for success, 401 for unauthorized, etc.)
   - Document possible error responses

3. **Security**
   - If a JWTService is used, include a JWT-based security scheme

4. **Additional Docs**
   - For each endpoint, add a usage description inferred from method name and parameters
   - Add curl examples for major operations
   - Document possible error codes (e.g., 401, 400)

5. **Donts**
   - please exclude and Do not put the header disclaimer which starts Below is the OpenAPI 3.0 specification
   - Do not include any explanations, summaries, or additional commentary such as "This YAML is structured to be..." Only output the pure OpenAPI YAML content.
---

Here are the REST controller classes:

\`\`\`json
${JSON.stringify(restControllers, null, 2)}
\`\`\`

Here is the full list of all classes (for context, including DTOs/entities):

\`\`\`json
${JSON.stringify(classesSummary, null, 2)}
\`\`\`

---

Generate the OpenAPI spec in YAML format. The output must be:
- Complete
- Validatable in Swagger Editor
- Ready to be used in API Gateway or Postman collections
- Human-readable with proper indentation and grouping
- Organized by tags (based on controller names or logical domains)
- Include JSON schema definitions under \`components.schemas\`
`;

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
    this.logInfo('🚀 Java Documentation MCP Server with Jira Integration running on stdio');

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
  console.error('\n🔧 Starting AutoDoc.AI MCP Server with Jira Integration...');
  console.info(`📍 Current directory: ${process.cwd()}`);
  console.info(`🐛 Node version: ${process.version}`);
  
  const server = new JavaDocumentationMCPServer();
  console.info('✅ Server instance created');
  console.info('🚀 Successfully launched MCP server');
  
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