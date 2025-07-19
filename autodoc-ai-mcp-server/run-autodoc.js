import { spawn } from 'child_process';

const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

//request
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
      openaiApiKey: process.env.OPENAI_API_KEY
    }
  }
};

server.stdin.write(JSON.stringify(request) + '\n');

let responseBuffer = '';

server.stdout.on('data', (data) => {
  const text = data.toString();
  responseBuffer += text;
  console.log('Response from server:\n', text);

  // Detect if response is a complete JSON-RPC response
  try {
    const parsed = JSON.parse(responseBuffer);
    if (parsed.jsonrpc && parsed.id === 2) {
      console.log('✅ Documentation generation completed.');

      // Gracefully close stdin and kill the process
      server.stdin.end();
      server.kill();
    }
  } catch (err) {
    // Wait for more data (response not fully received yet)
  }
});

server.stderr.on('data', (data) => {
  console.error('Server log:\n', data.toString());
});

server.on('exit', (code) => {
  console.log(`🔚 MCP server process exited with code ${code}`);
});
