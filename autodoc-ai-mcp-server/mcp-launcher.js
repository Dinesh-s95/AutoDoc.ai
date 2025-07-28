#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration object - modify these values as needed
const CONFIG = {
  // OpenAI Configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY, // Replace with your actual API key
    model: 'deepseek/deepseek-chat-v3-0324:free', // gpt-4, gpt-4-turbo or 'gpt-3.5-turbo' for faster/cheaper option
  },
  
  // Project paths
  paths: {
    microservicePath: '../identityprovider', // Path to your Java microservice
    outputPath: '../identityprovider/documentation', // Where to save generated documentation
    serverPath: path.join(__dirname, 'dist', 'mcp-server.js'), // Path to compiled MCP server
  },
  
  // Documentation settings
  documentation: {
    format: 'adoc', // 'adoc' or 'markdown'
    includeSequenceDiagrams: true,
    includeERDiagrams: true,
    includeReadme: true,
  },
  
  // Server settings
  server: {
    port: 3000, // Optional port for HTTP mode (if implementing)
    logLevel: 'info', // 'debug', 'info', 'warn', 'error'
  }
};

class MCPServerLauncher {
  constructor(config) {
    this.config = config;
    this.serverProcess = null;
  }

  async validateConfiguration() {
    console.log('🔍 Validating configuration...');

      console.log('\n⚙️  Configuration Summary:');
      console.log(`  🎯 Microservice Path: ${path.resolve(this.config.paths.microservicePath)}`);
      console.log(`  📁 Output Path: ${path.resolve(this.config.paths.outputPath)}`);
      console.log(`  📝 Documentation Format: ${this.config.documentation.format.toUpperCase()}`);
      console.log(`  🤖 OpenAI Model: ${this.config.openai.model}`);
    
    // Check if OpenAI API key is set
    if (!this.config.openai.apiKey || this.config.openai.apiKey === 'sk-your-openai-api-key-here') {
      throw new Error('❌ Please set your OpenAI API key in the CONFIG object');
    }

    // Check if microservice path exists
    try {
      await fs.access(this.config.paths.microservicePath);
      console.log('\n✅ Microservice path is accessible');
    } catch (error) {
      throw new Error(`❌ Microservice path not found: ${this.config.paths.microservicePath}`);
    }

    // Check if compiled server exists
    try {
      await fs.access(this.config.paths.serverPath);
      console.log('✅ MCP server binary found');
    } catch (error) {
      throw new Error(`❌ MCP server not found. Please run 'npm run build' first.\nLooking for: ${this.config.paths.serverPath}`);
    }

    // Create output directory if it doesn't exist
    try {
      await fs.mkdir(this.config.paths.outputPath, { recursive: true });
      console.log(`✅ Output directory ready: ${this.config.paths.outputPath}`);
    } catch (error) {
      throw new Error(`❌ Failed to create output directory: ${error.message}`);
    }
  }

  async generateInitialDocumentation() {    
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        OPENAI_API_KEY: this.config.openai.apiKey,
        OPENAI_MODEL: this.config.openai.model,
        MICROSERVICE_PATH: this.config.paths.microservicePath,
        OUTPUT_PATH: this.config.paths.outputPath,
        DOC_FORMAT: this.config.documentation.format,
        LOG_LEVEL: this.config.server.logLevel,
        EXIT_ON_TOOL_COMPLETE: 'true' // Ensures server exits after tool call
        // AUTO_RUN_PIPELINE intentionally omitted to avoid double execution
      };

      const serverProcess = spawn('node', [this.config.paths.serverPath], {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      let errorOutput = '';
      let ready = false;

      // Wait for a 'ready' or 'registered' message before sending the command
      const onData = (data) => {
        const message = data.toString();
        output += message;
        // console.log('📄 Server:', message.trim());
        if (!ready && (message.includes('tools registered') || message.includes('Ready to generate AI-enhanced documentation') || message.includes('MCP 1.15.1 tools registered'))) {
          ready = true;
          const pipelineCommand = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'full_pipeline',
              arguments: {
                projectPath: this.config.paths.microservicePath,
                outputDir: this.config.paths.outputPath,
                outputFormat: this.config.documentation.format
              }
            }
          });
          serverProcess.stdin.write(pipelineCommand + '\n');
        }
      };

      serverProcess.stdout.on('data', onData);

      serverProcess.stderr.on('data', (data) => {
        const message = data.toString();
        errorOutput += message;
        if (!ready && (message.includes('tools registered') || message.includes('Ready to generate AI-enhanced documentation') || message.includes('MCP 1.15.1 tools registered'))) {
          ready = true;
          const pipelineCommand = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'full_pipeline',
              arguments: {
                projectPath: this.config.paths.microservicePath,
                outputDir: this.config.paths.outputPath,
                outputFormat: this.config.documentation.format
              }
            }
          });
          serverProcess.stdin.write(pipelineCommand + '\n');
        }
        if (message.includes('error') || message.includes('Error')) {
          console.error('❌ Server Error:', message.trim());
        } else {
          console.log('🔧 Server Log:', message.trim());
        }
      });


      let settled = false;
      const settle = (code) => {
        if (settled) return;
        settled = true;
        if (code === 0) {
          resolve(output);
        } else {
          console.error(`❌ Server process exited with code ${code}`);
          reject(new Error(`Server failed with exit code ${code}\nError output: ${errorOutput}`));
        }
      };
      serverProcess.on('close', settle);
      serverProcess.on('exit', settle);

      // Set a timeout for the documentation generation
      setTimeout(() => {
        serverProcess.kill();
        reject(new Error('Documentation generation timed out after 5 minutes'));
      }, 300000); // 5 minutes
    });
  }

  async startInteractiveModeServer() {
    console.log('🚀 Starting MCP server in interactive mode...');
    
    const env = {
      ...process.env,
      OPENAI_API_KEY: this.config.openai.apiKey,
      OPENAI_MODEL: this.config.openai.model,
      MICROSERVICE_PATH: this.config.paths.microservicePath,
      OUTPUT_PATH: this.config.paths.outputPath,
      DOC_FORMAT: this.config.documentation.format,
      LOG_LEVEL: this.config.server.logLevel
    };

    this.serverProcess = spawn('node', [this.config.paths.serverPath], {
      env,
      stdio: ['inherit', 'inherit', 'inherit']
    });

    this.serverProcess.on('close', (code) => {
      console.log(`🔚 MCP server process exited with code ${code}`);
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down MCP server...');
      if (this.serverProcess) {
        this.serverProcess.kill('SIGTERM');
      }
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n🛑 Received SIGTERM, shutting down MCP server...');
      if (this.serverProcess) {
        this.serverProcess.kill('SIGTERM');
      }
      process.exit(0);
    });

    return this.serverProcess;
  }

  async displayResults() {
    // console.log('\n Generated Documentation Files:');
    
    try {      
      // console.log(`\n📂 Complete destination path: ${path.resolve(this.config.paths.outputPath)}`);
      
      // Display configuration summary
      console.log('\n⚙️  Configuration Summary:');
      console.log(`  🎯 Microservice Path: ${path.resolve(this.config.paths.microservicePath)}`);
      console.log(`  📁 Output Path: ${path.resolve(this.config.paths.outputPath)}`);
      console.log(`  📝 Documentation Format: ${this.config.documentation.format.toUpperCase()}`);
      console.log(`  🤖 OpenAI Model: ${this.config.openai.model}`);
      
    } catch (error) {
      console.error('❌ Error reading output directory:', error.message);
    }
  }
}

// Main execution function
async function main() {
  console.log('🎯 Java Documentation MCP Server Launcher');
  console.log('==========================================\n');

  const launcher = new MCPServerLauncher(CONFIG);

  try {
    // Validate configuration
    await launcher.validateConfiguration();
    
    // Get command line arguments
    const args = process.argv.slice(2);
    const mode = args[0] || 'generate';

    switch (mode) {
      case 'generate':
        console.log('📚 Running in detached mode...\n');
        await launcher.generateInitialDocumentation();
        await launcher.displayResults();
        process.exit(0);
        break;
        
      case 'server':
        console.log('🚀 Running in interactive server mode...\n');
        console.log('💡 The server is now running and ready to accept MCP requests');
        console.log('🔗 Configure your Claude Desktop to connect to this server');
        console.log('⏹️  Press Ctrl+C to stop the server\n');
        await launcher.startInteractiveModeServer();
        break;
        
      case 'config':
        console.log('⚙️  Current Configuration:');
        console.log(JSON.stringify(CONFIG, null, 2));
        break;
        
      default:
        console.log('📖 Usage:');
        console.log('  node launcher.js generate  - Generate documentation and exit');
        console.log('  node launcher.js server    - Start interactive MCP server');
        console.log('  node launcher.js config    - Display current configuration');
        console.log('\n💡 Edit the CONFIG object in this file to customize settings');
        break;
    }

  } catch (error) {
    console.error('\n💥 Error:', error.message);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the launcher
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}