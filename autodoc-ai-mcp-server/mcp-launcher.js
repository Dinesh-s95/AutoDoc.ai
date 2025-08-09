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
    apiKey: process.env.OPENAI_API_KEY || 'sk-your-openai-api-key-here',
    model: 'gpt-4-turbo',
  },
  
  // Jira Configuration
  jira: {
    baseUrl: 'https://sharan99r.atlassian.net', // e.g., https://company.atlassian.net
    email: 'sharan99r@gmail.com',
    apiToken: 'ATATT3xFfGF0aOGqDQfxsCI9Zl2RHA_jBzhr5GLhZlw2eQIryWgfuXh-ovJ0vaOLkUdojxW2YCrVeHNRnaAlj4N23E-f10W1ppXRxDqfhD3qU1Xk2-DrJ-CCfQwf8X8zMw021Ea5jYyCaOl0ZriLHspcSMBfiLpUSD7c8ZTBX7If3jbaP22kz0s=828D2C0B',
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
    generateReleaseNotes: true, // New option for release notes
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
    console.log(`  🔗 Jira Integration: ${this.config.jira.baseUrl !== 'https://your-domain.atlassian.net' ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`  🏷️  Release Notes: ${this.config.documentation.generateReleaseNotes ? '✅ Enabled' : '❌ Disabled'}`);
    
    // Check if OpenAI API key is set
    if (!this.config.openai.apiKey || this.config.openai.apiKey === 'sk-your-openai-api-key-here') {
      throw new Error('❌ Please set your OpenAI API key in the CONFIG object or OPENAI_API_KEY environment variable');
    }

    // Check Jira configuration if release notes are enabled
    if (this.config.documentation.generateReleaseNotes) {
      const jiraConfigured = this.config.jira.baseUrl !== 'https://your-domain.atlassian.net' &&
                            this.config.jira.email !== 'your-email@company.com' &&
                            this.config.jira.apiToken !== 'your-jira-api-token';
      
      if (!jiraConfigured) {
        console.log('⚠️  Jira not configured - release notes will be skipped');
        console.log('💡 To enable release notes, configure JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN');
      } else {
        console.log('✅ Jira configuration appears valid');
      }
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
        EXIT_ON_TOOL_COMPLETE: 'true', // Ensures server exits after tool call
        // Jira configuration
        JIRA_BASE_URL: this.config.jira.baseUrl,
        JIRA_EMAIL: this.config.jira.email,
        JIRA_API_TOKEN: this.config.jira.apiToken,
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
                outputFormat: this.config.documentation.format,
                generateReleaseNotes: this.config.documentation.generateReleaseNotes
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
                outputFormat: this.config.documentation.format,
                generateReleaseNotes: this.config.documentation.generateReleaseNotes
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
        if (!settled) {
          serverProcess.kill();
          reject(new Error('Documentation generation timed out after 5 minutes'));
        }
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
      LOG_LEVEL: this.config.server.logLevel,
      // Jira configuration
      JIRA_BASE_URL: this.config.jira.baseUrl,
      JIRA_EMAIL: this.config.jira.email,
      JIRA_API_TOKEN: this.config.jira.apiToken,
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
    try {      
      // Display configuration summary
      console.log('\n⚙️  Configuration Summary:');
      console.log(`  🎯 Microservice Path: ${path.resolve(this.config.paths.microservicePath)}`);
      console.log(`  📁 Output Path: ${path.resolve(this.config.paths.outputPath)}`);
      console.log(`  📝 Documentation Format: ${this.config.documentation.format.toUpperCase()}`);
      console.log(`  🤖 OpenAI Model: ${this.config.openai.model}`);
      console.log(`  🔗 Jira Integration: ${this.config.jira.baseUrl !== 'https://your-domain.atlassian.net' ? '✅ Configured' : '❌ Not configured'}`);
      console.log(`  🏷️  Release Notes: ${this.config.documentation.generateReleaseNotes ? '✅ Enabled' : '❌ Disabled'}`);
      
    } catch (error) {
      console.error('❌ Error reading output directory:', error.message);
    }
  }

  async processAllServices() {
    // List of all services
    const services = [
      { name: 'identityprovider', path: '../identityprovider' },
      { name: 'enrollment', path: '../enrollment' },
      { name: 'usermanagement', path: '../usermanagement' },
      { name: 'vehiclemanagement', path: '../vehiclemanagement' }
    ];

    const totalServices = services.length;
    const results = {
      successful: [],
      failed: []
    };

    console.log(`\n🚀 Starting documentation generation for ${totalServices} services\n`);
    console.log('=' .repeat(60));

    for (let i = 0; i < services.length; i++) {
      const svc = services[i];
      const currentIndex = i + 1;
      
      console.log(`\n📦 Generating docs for [${currentIndex}/${totalServices}]: ${svc.name}`);
      console.log('-'.repeat(50));
      
      // Update config for this service
      const originalMicroservicePath = this.config.paths.microservicePath;
      const originalOutputPath = this.config.paths.outputPath;
      
      this.config.paths.microservicePath = svc.path;
      this.config.paths.outputPath = `${svc.path}/documentation`;
      
      const startTime = Date.now();
      
      try {
        await this.validateConfiguration();
        await this.generateInitialDocumentation();
        
        const duration = Math.round((Date.now() - startTime) / 1000);
        console.log(`✅ [${currentIndex}/${totalServices}] ${svc.name} completed successfully (${duration}s)`);
        
        results.successful.push({
          name: svc.name,
          duration: duration,
          outputPath: this.config.paths.outputPath
        });
        
      } catch (err) {
        const duration = Math.round((Date.now() - startTime) / 1000);
        console.error(`❌ [${currentIndex}/${totalServices}] ${svc.name} failed after ${duration}s:`, err.message);
        
        results.failed.push({
          name: svc.name,
          error: err.message,
          duration: duration
        });
      }
      
      // Restore original config
      this.config.paths.microservicePath = originalMicroservicePath;
      this.config.paths.outputPath = originalOutputPath;
    }

    // Display final summary
    this.displayFinalSummary(results, totalServices);
  }

  displayFinalSummary(results, totalServices) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(60));
    
    console.log(`\n📈 Total Services: ${totalServices}`);
    console.log(`✅ Successful: ${results.successful.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    
    if (results.successful.length > 0) {
      console.log('\n✅ Successfully Processed Services:');
      results.successful.forEach((svc, index) => {
        console.log(`   ${index + 1}. ${svc.name} (${svc.duration}s) → ${svc.outputPath}`);
      });
    }
    
    if (results.failed.length > 0) {
      console.log('\n❌ Failed Services:');
      results.failed.forEach((svc, index) => {
        console.log(`   ${index + 1}. ${svc.name} (${svc.duration}s) - ${svc.error}`);
      });
    }
    
    const totalTime = results.successful.reduce((sum, svc) => sum + svc.duration, 0) + 
                     results.failed.reduce((sum, svc) => sum + svc.duration, 0);
    
    console.log(`\n⏱️  Total Processing Time: ${Math.round(totalTime)}s`);
    console.log(`📊 Success Rate: ${Math.round((results.successful.length / totalServices) * 100)}%`);
    
    console.log('\n' + '='.repeat(60));
  }

  async testJiraConnection() {
    console.log('🔍 Testing Jira connection...');
    
    if (this.config.jira.baseUrl === 'https://your-domain.atlassian.net' ||
        this.config.jira.email === 'your-email@company.com' ||
        this.config.jira.apiToken === 'your-jira-api-token') {
      console.log('❌ Jira not configured. Please update the CONFIG object with your Jira details.');
      return false;
    }

    try {
      const auth = Buffer.from(`${this.config.jira.email}:${this.config.jira.apiToken}`).toString('base64');
      
      const response = await fetch(`${this.config.jira.baseUrl}/rest/api/3/myself`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
        }
      });

      if (response.ok) {
        const user = await response.json();
        console.log(`✅ Jira connection successful! Logged in as: ${user.displayName} (${user.emailAddress})`);
        return true;
      } else {
        console.log(`❌ Jira connection failed: ${response.status} ${response.statusText}`);
        return false;
      }
    } catch (error) {
      console.log(`❌ Jira connection error: ${error.message}`);
      return false;
    }
  }
}

// Main execution function
async function main() {
  console.log('🎯 Java Documentation MCP Server Launcher with Jira Integration');
  console.log('================================================================\n');

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

      case 'all':
        await launcher.processAllServices();
        process.exit(0);
        break;

      case 'server':
        console.log('🚀 Running in interactive server mode...\n');
        console.log('💡 The server is now running and ready to accept MCP requests');
        console.log('🔗 Configure your Claude Desktop to connect to this server');
        console.log('⏹️  Press Ctrl+C to stop the server\n');
        await launcher.startInteractiveModeServer();
        break;

      case 'test-jira':
        await launcher.testJiraConnection();
        break;

      case 'config':
        console.log('⚙️  Current Configuration:');
        const configDisplay = {
          ...CONFIG,
          openai: {
            ...CONFIG.openai,
            apiKey: CONFIG.openai.apiKey.startsWith('sk-') ? '***CONFIGURED***' : '***NOT SET***'
          },
          jira: {
            ...CONFIG.jira,
            apiToken: CONFIG.jira.apiToken !== 'your-jira-api-token' ? '***CONFIGURED***' : '***NOT SET***'
          }
        };
        console.log(JSON.stringify(configDisplay, null, 2));
        break;

      default:
        console.log('📖 Usage:');
        console.log('  node launcher.js generate     - Generate documentation and exit');
        console.log('  node launcher.js all          - Generate documentation for all services');
        console.log('  node launcher.js server       - Start interactive MCP server');
        console.log('  node launcher.js test-jira    - Test Jira connection');
        console.log('  node launcher.js config       - Display current configuration');
        console.log('\n🏷️  Release Notes Feature:');
        console.log('  • Automatically extracts Jira ticket numbers from commit messages');
        console.log('  • Expected format: "TICKET-123 your commit message"');
        console.log('  • Fetches ticket title from Jira API');
        console.log('  • Creates release notes in format: "TICKET-123 & Title & 2025.3"');
        console.log('\n🔧 Jira Configuration:');
        console.log('  • Set JIRA_BASE_URL (e.g., https://company.atlassian.net)');
        console.log('  • Set JIRA_EMAIL (your Atlassian email)');
        console.log('  • Set JIRA_API_TOKEN (generate from Atlassian account settings)');
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