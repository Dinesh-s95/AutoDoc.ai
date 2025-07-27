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
      //openaiApiKey: process.env.OPENAI_API_KEY,
      openaiApiKey: '',
    }
  }
};

server.stdin.write(JSON.stringify(request) + '\n');

let responseBuffer = '';

server.stdout.on('data', (data) => {
  const text = data.toString();
  responseBuffer += text;
  console.log('Response from server:\n', text);

  // Try to extract and parse all complete JSON objects in the buffer
  let startIdx = responseBuffer.indexOf('{');
  let endIdx = responseBuffer.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const possibleJson = responseBuffer.substring(startIdx, endIdx + 1);
    try {
      const parsed = JSON.parse(possibleJson);
      if (parsed.jsonrpc && parsed.id === 2) {
        console.log('✅ Documentation generation completed.');
        server.stdin.end();
        server.kill();
      }
    } catch (err) {
      // Not a valid JSON yet, wait for more data
    }
  }
});

server.stderr.on('data', (data) => {
  console.error('Server log:\n', data.toString());
});

server.on('exit', (code) => {
  console.log(`🔚 MCP server process exited with code ${code}`);
});
