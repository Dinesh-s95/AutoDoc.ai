import { spawn } from 'child_process';

const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

const request = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: {
    name: 'generate_ai_documentation',
    arguments: {
      projectPath: '../',
      language: 'java',
      framework: 'spring-boot',
      outputPath: '../generated-docs',
      openaiApiKey: ''
    }
  }
};

server.stdin.write(JSON.stringify(request) + '\n');

server.stdout.on('data', (data) => {
  console.log('Response from server:\n', data.toString());
});

server.stderr.on('data', (data) => {
  console.log('Server log:\n', data.toString());
});
